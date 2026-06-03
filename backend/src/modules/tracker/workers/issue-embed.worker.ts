import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type IssueEmbedJobData, TRACKER_QUEUE_NAMES } from '../queues';

/**
 * IssueEmbedWorker — consumer очереди `core.issue-embed`
 * (Tracker Phase 3 / Sprint 6, 2026-05-24).
 *
 * Производит pgvector(1536)-embedding для `Issue.title + descriptionStripped`
 * с помощью `EmbeddingFallbackService` (OpenAI-via-proxy → local fallback).
 *
 * Поведение:
 *   1. Загружает `Issue` (с tenant-фильтром, защита от cross-tenant).
 *   2. Считает `sha256(text)`; если совпал с `embeddingHash` — `skipped`.
 *   3. Иначе — embedding одного текста → `UPDATE "Issue" SET embedding=...,
 *      embeddingHash=... WHERE id=? AND tenantId=?`.
 *   4. На каждый исход — метрика `tracker_issue_embed_total{tenant_top,status}`.
 *
 * Concurrency: 4 (embedding'и быстрые ≈ 100-300мс, узкое место — proxy
 * rate-limit; 4 даёт запас).
 *
 * Defense-in-depth: `@Optional()` на `EmbeddingFallbackService` — чтобы
 * unit-тест мог стартовать worker без полного модуля; если в проде
 * сервиса нет (мисконфиг) — job упадёт с явным "embeddings disabled" вместо
 * NPE.
 */
@Injectable()
export class IssueEmbedWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IssueEmbedWorker.name);
  private worker: Worker<IssueEmbedJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<IssueEmbedJobData>(
      TRACKER_QUEUE_NAMES.ISSUE_EMBED,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'tracker.issue-embed', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      const tenantTop = tenantTopOf(job?.data?.tenantId);
      this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'failed' });
      this.logger.warn(
        {
          issueId: job?.data?.issueId,
          tenantId: job?.data?.tenantId,
          attemptsMade: job?.attemptsMade,
          err: err.message,
        },
        'issue-embed: job failed',
      );
    });
    this.logger.log(
      `IssueEmbedWorker запущен (${TRACKER_QUEUE_NAMES.ISSUE_EMBED}, concurrency=4)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главная обработка job'а.
   *
   * Внутренне ловит `embedding.embed()` и в случае ошибки — `throw` (BullMQ
   * сделает retry). Метрика `failed` фиксируется через `failed` listener,
   * чтобы не дублировать на каждой попытке.
   */
  async process(job: Job<IssueEmbedJobData>): Promise<void> {
    const { tenantId, issueId } = job.data;
    const tenantTop = tenantTopOf(tenantId);

    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, tenantId },
      select: {
        id: true,
        tenantId: true,
        title: true,
        description: true,
        descriptionStripped: true,
        embeddingHash: true,
      },
    });
    if (!issue) {
      // Задача удалена (soft/hard) — не считаем как failure. Метрика skipped
      // чтобы видеть в дашборде «потерянные» enqueue.
      this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'skipped' });
      this.logger.debug(
        { issueId, tenantId },
        'issue-embed: задача не найдена (удалена?), пропуск',
      );
      return;
    }

    const text = this.buildText(issue.title, issue.descriptionStripped, issue.description);
    if (text.length === 0) {
      // Нет текста для embedding'а — нечего считать.
      this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'skipped' });
      return;
    }

    const newHash = sha256Hex(text);
    if (newHash === issue.embeddingHash) {
      this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'skipped' });
      this.logger.debug({ issueId }, 'issue-embed: hash совпал — skip');
      return;
    }

    if (!this.embeddings) {
      // Embeddings выключены/не инжектируются. Не падаем с retry-штормом —
      // явное логирование и skipped, чтобы оператор увидел в дашборде.
      this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'skipped' });
      this.logger.warn(
        { issueId },
        'issue-embed: EmbeddingFallbackService не доступен — пропуск',
      );
      return;
    }

    const vectors = await this.embeddings.embed([text]);
    const vector = vectors[0];
    if (!vector || vector.length === 0) {
      throw new Error(
        `issue-embed: пустой embedding для issueId=${issueId} (провайдер вернул []/empty)`,
      );
    }

    // UPDATE с tenant-предохранителем. Не пересоздаём строку — только embedding+hash.
    // Лит. вид pgvector: '[1.2,3.4,...]'::vector(1536).
    await this.prisma.$executeRawUnsafe(
      'UPDATE "Issue" SET embedding = $1::vector(1536), "embeddingHash" = $2 WHERE id = $3 AND "tenantId" = $4',
      toVectorLiteral(vector),
      newHash,
      issueId,
      tenantId,
    );
    this.metrics.incTrackerIssueEmbed({ tenantTop, status: 'ok' });
    this.logger.debug(
      { issueId, dim: vector.length },
      'issue-embed: embedding обновлён',
    );
  }

  /**
   * Собирает текст для embedding'а: `title\n\ndescription`.
   * Приоритет `descriptionStripped` (plain text) > `description` (raw rich-text JSON).
   * Тримим всё; если result пустой → возвращаем '' (caller сделает skip).
   */
  private buildText(
    title: string,
    descriptionStripped: string | null | undefined,
    description: string | null | undefined,
  ): string {
    const desc = (descriptionStripped ?? description ?? '').trim();
    const t = title.trim();
    if (t.length === 0 && desc.length === 0) return '';
    if (desc.length === 0) return t;
    return `${t}\n\n${desc}`;
  }
}

/** sha256(text) → hex. Стабильный hash для idempotent embedding-pipeline. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** pgvector литерал: number[] → '[v1,v2,...]'. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
