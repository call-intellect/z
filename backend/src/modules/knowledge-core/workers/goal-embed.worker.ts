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

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type GoalEmbedJobData } from '../../core-queue/queues';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';

/**
 * GoalEmbedWorker — consumer очереди `core.goal-embed`
 * (Ф5, TZ 2026-06-16 task-dedup). Зеркало `IssueEmbedWorker`.
 *
 * Производит pgvector-embedding для `Goal.name + description` с помощью
 * `EmbeddingFallbackService` (OpenAI-via-proxy → local fallback). Нужен для
 * семантического дедупа целей (specialist-3-14 KNN по `Goal.embedding` вместо
 * ILIKE по 2 словам).
 *
 * Поведение (идентично issue-embed):
 *   1. Загружает `Goal` (с tenant-фильтром, защита от cross-tenant).
 *   2. Считает `sha256(text)`; если совпал с `embeddingHash` — `skipped`
 *      (идемпотентность: повторный enqueue с тем же текстом ничего не пересчитывает).
 *   3. Иначе — embedding одного текста → `UPDATE "Goal" SET embedding=...,
 *      embeddingHash=... WHERE id=? AND tenantId=?`.
 *
 * Concurrency: 4 (embedding'и быстрые ≈ 100-300мс, узкое место — proxy
 * rate-limit; как у IssueEmbedWorker).
 *
 * Defense-in-depth: `@Optional()` на `EmbeddingFallbackService` — чтобы
 * unit-тест мог стартовать worker без полного модуля; если в проде сервиса
 * нет (мисконфиг) — job не падает с retry-штормом, а тихо skip'ается.
 */
@Injectable()
export class GoalEmbedWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoalEmbedWorker.name);
  private worker: Worker<GoalEmbedJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<GoalEmbedJobData>(
      CORE_QUEUE_NAMES.GOAL_EMBED,
      async (job) =>
        this.pipe.job(
          SystemLogPipeline.KNOWLEDGE_GRAPH,
          'core.goal-embed',
          job,
          () => this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          goalId: job?.data?.goalId,
          tenantId: job?.data?.tenantId,
          attemptsMade: job?.attemptsMade,
          err: err.message,
        },
        'goal-embed: job failed',
      );
    });
    this.logger.log(
      `GoalEmbedWorker запущен (${CORE_QUEUE_NAMES.GOAL_EMBED}, concurrency=4)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главная обработка job'а. При ошибке embed — `throw` (BullMQ сделает retry).
   */
  async process(job: Job<GoalEmbedJobData>): Promise<void> {
    const { tenantId, goalId } = job.data;

    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        description: true,
        embeddingHash: true,
      },
    });
    if (!goal) {
      // Цель удалена/недоступна — не считаем как failure.
      this.logger.debug(
        { goalId, tenantId },
        'goal-embed: цель не найдена (удалена?), пропуск',
      );
      return;
    }

    const text = this.buildText(goal.name, goal.description);
    if (text.length === 0) {
      // Нет текста для embedding'а — нечего считать.
      return;
    }

    const newHash = sha256Hex(text);
    if (newHash === goal.embeddingHash) {
      this.logger.debug({ goalId }, 'goal-embed: hash совпал — skip');
      return;
    }

    if (!this.embeddings) {
      this.logger.warn(
        { goalId },
        'goal-embed: EmbeddingFallbackService не доступен — пропуск',
      );
      return;
    }

    const vectors = await this.embeddings.embed([text]);
    const vector = vectors[0];
    if (!vector || vector.length === 0) {
      throw new Error(
        `goal-embed: пустой embedding для goalId=${goalId} (провайдер вернул []/empty)`,
      );
    }

    // UPDATE с tenant-предохранителем. Не пересоздаём строку — только embedding+hash.
    // Лит. вид pgvector: '[1.2,3.4,...]'::vector.
    await this.prisma.$executeRawUnsafe(
      'UPDATE "Goal" SET embedding = $1::vector, "embeddingHash" = $2 WHERE id = $3 AND "tenantId" = $4',
      toVectorLiteral(vector),
      newHash,
      goalId,
      tenantId,
    );
    this.logger.debug(
      { goalId, dim: vector.length },
      'goal-embed: embedding обновлён',
    );
  }

  /**
   * Текст для embedding'а: `name\n\ndescription`. У Goal `description` —
   * non-null `@db.Text` (но при равенстве name/description дубль не страшен —
   * совпадает с queryText дедупа `name description`). Тримим всё.
   */
  private buildText(name: string, description: string | null | undefined): string {
    const desc = (description ?? '').trim();
    const t = name.trim();
    if (t.length === 0 && desc.length === 0) return '';
    if (desc.length === 0) return t;
    if (t.length === 0) return desc;
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
