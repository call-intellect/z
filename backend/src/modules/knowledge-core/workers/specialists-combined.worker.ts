import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { SourceType } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type SpecialistsCombinedJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import type {
  CombinedChannelKind,
  CombinedInputBlock,
} from '../prompts/specialists-combined.prompt';
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
        this.pipe.meeting(
          SystemLogPipeline.AI_ANALYSIS,
          'kc.specialists-combined',
          this.resolveExternalId(job.data),
          () => this.process(job),
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
          sourceType: job?.data.sourceType ?? 'meeting',
          externalId: job ? this.resolveExternalId(job.data) : undefined,
          attempt: job?.attemptsMade,
          err: err.message,
        },
        'specialists-combined: job failed',
      );
    });
    this.logger.debug(
      `SpecialistsCombinedWorker запущен (${CORE_QUEUE_NAMES.SPECIALISTS_COMBINED})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<SpecialistsCombinedJobData>): Promise<void> {
    const sourceType = job.data.sourceType ?? 'meeting';
    const externalId = this.resolveExternalId(job.data);

    if (this.cfg && this.cfg.specialistsCombined.enabled === false) {
      this.logger.debug(
        { sourceType, externalId },
        'specialists-combined: SPECIALISTS_COMBINED_ENABLED=false — skip',
      );
      return;
    }

    const tenantId = job.data.tenantId;
    if (!tenantId) {
      this.logger.warn(
        { sourceType, externalId },
        'specialists-combined: tenantId отсутствует в payload — skip',
      );
      return;
    }

    const rawEvent = await this.prisma.rawEvent.findFirst({
      where: { tenantId, sourceType: sourceType as SourceType, sourceExternalId: externalId },
      select: { sourceTitle: true, dataClass: true },
      orderBy: { occurredAt: 'desc' },
    });
    if (!rawEvent) {
      this.logger.debug(
        { sourceType, externalId, tenantId },
        'specialists-combined: RawEvent источника не найден — skip',
      );
      return;
    }

    const channelKind: CombinedChannelKind = sourceType === 'meeting' ? 'meeting' : 'chat';

    if (channelKind === 'meeting') {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: externalId },
        select: { deletedAt: true },
      });
      if (meeting?.deletedAt) {
        this.logger.debug({ externalId }, 'specialists-combined: meeting удалён — skip');
        return;
      }
    }

    const sourceTitle =
      rawEvent.sourceTitle ?? (channelKind === 'chat' ? 'Переписка' : `meeting:${externalId}`);

    const sourceBlocks = await this.blockFetch.getCanonicalBlocksForSource(
      tenantId,
      sourceType,
      externalId,
    );
    if (sourceBlocks.length === 0) {
      this.logger.debug(
        { sourceType, externalId, tenantId },
        'specialists-combined: нет canonical-блоков — skip',
      );
      return;
    }

    const blockIds = sourceBlocks.map((b) => b.id);
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

    const inputBlocks: CombinedInputBlock[] = sourceBlocks.map((b) => {
      const evidence0 = b.evidence[0];
      const speaker = evidence0?.authorLabel?.trim();
      return {
        id: b.id,
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        trustedAnswer: b.trustedAnswer,
        signalType: b.signalType,
        personNames: personNamesByBlock.get(b.id) ?? [],
        evidence: {
          quote: evidence0?.quote ?? '',
          speaker: speaker && speaker.length > 0 ? speaker : '—',
        },
      };
    });

    try {
      const result = await this.combined.extractAll({
        tenantId,
        meetingId: externalId,
        meetingTitle: sourceTitle,
        blocks: inputBlocks,
        channelKind,
        sourceType,
        dataClass: rawEvent.dataClass,
        ...(job.id ? { jobId: job.id } : {}),
      });
      this.logger.debug(
        {
          sourceType,
          externalId,
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
        this.logger.error(
          {
            sourceType,
            externalId,
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

  private resolveExternalId(data: SpecialistsCombinedJobData): string {
    return data.externalId ?? data.meetingId ?? '';
  }
}
