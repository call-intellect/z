/**
 * SpecialistsCombinedWorker — ТЗ 2026-05-25 llm-architecture-changes §3
 * (Variant Б+).
 *
 * Consumer `core.specialists-combined`. На вход — `{ meetingId }`. Загружает
 * canonical-блоки встречи через `BlockFetchService`, конвертирует в
 * `CombinedInputBlock[]` (формат из §3.5 ТЗ) и дёргает
 * `SpecialistsCombinedService.extractAll`. Один LLM-вызов на ВСЕ блоки.
 *
 * Producer'ы: на 2026-06-10 cron-producer удалён вместе с v2-стеком (он работал
 * только при `KNOWLEDGE_CORE_V2_AGENTS_ENABLED=true`, который прод никогда не
 * включал). Enqueue остаётся доступен через `CoreQueueService.enqueueSpecialistsCombined`
 * (ручной запуск / тесты); per-block специалисты продолжают работать через
 * `block-ingest.worker → router.dispatch`.
 *
 * Идемпотентность через jobId=`specialists_combined_<meetingId>` (CoreQueueService).
 * Concurrency=1 — один большой LLM-вызов на встречу, упираемся в провайдера.
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistsCombinedJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import type { CombinedInputBlock } from '../prompts/specialists-combined.prompt';
import { BlockFetchService } from '../services/block-fetch.service';
import {
  SpecialistsCombinedParseError,
  SpecialistsCombinedService,
} from '../services/specialists-combined.service';

@Injectable()
export class SpecialistsCombinedWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpecialistsCombinedWorker.name);
  private worker: Worker<SpecialistsCombinedJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlockFetchService) private readonly blockFetch: BlockFetchService,
    @Inject(SpecialistsCombinedService)
    private readonly combined: SpecialistsCombinedService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SpecialistsCombinedJobData>(
      CORE_QUEUE_NAMES.SPECIALISTS_COMBINED,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.AI_ANALYSIS, 'kc.specialists-combined', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          attempt: job?.attemptsMade,
          err: err.message,
        },
        'specialists-combined: job failed',
      );
    });
    this.logger.log(
      `SpecialistsCombinedWorker запущен (${CORE_QUEUE_NAMES.SPECIALISTS_COMBINED})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главный handler. Public — удобно дёргать из integration-тестов без BullMQ.
   */
  async process(job: Job<SpecialistsCombinedJobData>): Promise<void> {
    const { meetingId } = job.data;

    // Master-флаг — даже если в очереди уже есть jobs, при отключении флага
    // на проде хотим тихо пропускать (best-effort на rollback).
    if (this.cfg && this.cfg.specialistsCombined.enabled === false) {
      this.logger.debug(
        { meetingId },
        'specialists-combined: SPECIALISTS_COMBINED_ENABLED=false — skip',
      );
      return;
    }

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, tenantId: true, title: true, deletedAt: true },
    });
    if (!meeting) {
      this.logger.debug(
        { meetingId },
        'specialists-combined: meeting не найден — skip',
      );
      return;
    }
    if (meeting.deletedAt) {
      this.logger.debug(
        { meetingId },
        'specialists-combined: meeting удалён — skip',
      );
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn(
        { meetingId },
        'specialists-combined: tenantId=null (legacy) — skip',
      );
      return;
    }
    const tenantId = meeting.tenantId;

    const meetingBlocks = await this.blockFetch.getCanonicalBlocksForMeeting(
      meetingId,
      tenantId,
    );
    if (meetingBlocks.length === 0) {
      this.logger.debug(
        { meetingId, tenantId },
        'specialists-combined: нет canonical-блоков — skip',
      );
      return;
    }

    // Для knowledge_categories / skill_traits / helpfulness_traits нужны
    // имена участников блока. Один SQL — IdeaBlockEntity → Entity (type=person)
    // → Person.name. Ограничиваем 200 ассоциациями (защита от баласта).
    const blockIds = meetingBlocks.map((b) => b.id);
    const personMentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId: { in: blockIds },
        role: { in: ['subject', 'mentioned'] },
        entity: { type: 'person' },
      },
      select: { blockId: true, entity: { select: { canonicalName: true } } },
      take: 1000,
    });
    const personNamesByBlock = new Map<string, string[]>();
    for (const m of personMentions) {
      const list = personNamesByBlock.get(m.blockId) ?? [];
      const name = m.entity?.canonicalName ?? null;
      if (name && !list.includes(name)) {
        list.push(name);
      }
      personNamesByBlock.set(m.blockId, list);
    }

    // Конвертация в CombinedInputBlock[].
    const inputBlocks: CombinedInputBlock[] = meetingBlocks.map((b) => {
      const evidence0 = b.evidence[0];
      return {
        id: b.id,
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        trustedAnswer: b.trustedAnswer,
        signalType: b.signalType,
        personNames: personNamesByBlock.get(b.id) ?? [],
        evidence: {
          quote: evidence0?.quote ?? '',
          speaker: '—',
        },
      };
    });

    try {
      const result = await this.combined.extractAll({
        tenantId,
        meetingId,
        meetingTitle: meeting.title,
        blocks: inputBlocks,
        ...(job.id ? { jobId: job.id } : {}),
      });
      this.logger.log(
        {
          meetingId,
          tenantId,
          blocksUsed: inputBlocks.length,
          created: result.created,
          emptySections: result.emptySections.length,
          errors: result.errors.length,
          modelUsed: result.llm.modelUsed,
          durationMs: result.llm.durationMs,
        },
        'specialists-combined: done',
      );
    } catch (err) {
      if (err instanceof SpecialistsCombinedParseError) {
        // Парсер упал — это не баг провайдера, retry не поможет.
        // Логируем и завершаем без throw (job уйдёт в completed,
        // не будет крутиться).
        this.logger.error(
          {
            meetingId,
            tenantId,
            err: err.message,
            rawTextPreview: err.rawText?.slice(0, 500) ?? '',
          },
          'specialists-combined: parse error — финализируем job без retry',
        );
        return;
      }
      throw err;
    }
  }
}
