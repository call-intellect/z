import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import {
  type AiJobData,
  type CardRollupJobData,
  type ClipRenderJobData,
  type CustomReportJobData,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
  type QueueName,
} from './queues';

const CLIP_RENDER_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86400, count: 200 },
  removeOnFail: false,
};

const CARD_ROLLUP_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: false,
  delay: 5_000,
};

const CUSTOM_REPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86400, count: 500 },
  removeOnFail: false,
};

const RECORDING_FASTSTART_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86400, count: 200 },
  removeOnFail: false,
};

@Injectable()
export class AiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiQueueService.name);
  private queues: Map<QueueName, Queue<unknown>> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<QueueName, Queue<unknown>>();
    for (const name of Object.values(QUEUE_NAMES)) {
      let opts: JobsOptions;
      if (name === QUEUE_NAMES.CLIP_RENDER) {
        opts = CLIP_RENDER_JOB_OPTIONS;
      } else if (name === QUEUE_NAMES.CARD_ROLLUP) {
        opts = CARD_ROLLUP_JOB_OPTIONS;
      } else if (name === QUEUE_NAMES.CUSTOM_REPORT) {
        opts = CUSTOM_REPORT_JOB_OPTIONS;
      } else if (name === QUEUE_NAMES.RECORDING_FASTSTART) {
        opts = RECORDING_FASTSTART_JOB_OPTIONS;
      } else {
        opts = DEFAULT_JOB_OPTIONS;
      }
      map.set(
        name,
        new Queue<unknown>(name, {
          connection,
          defaultJobOptions: opts,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`AiQueueService инициализирован (${map.size} очередей)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queues) return;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${q.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.queues = null;
  }

  enqueueTranscribe(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.TRANSCRIBE, meetingId, attempt);
  }

  enqueueMerge(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.MERGE, meetingId, attempt);
  }

  enqueueAnalyze(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.ANALYZE, meetingId, attempt);
  }

  enqueueNotify(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.NOTIFY, meetingId, attempt);
  }

  enqueueTranscriptIndex(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.EMBEDDINGS, meetingId, attempt);
  }

  enqueueBehaviorMetrics(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.BEHAVIOR_METRICS, meetingId, attempt);
  }

  async enqueueTranscriptClean(meetingId: string): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.TRANSCRIPT_CLEAN);
    if (!q) throw new Error('AiQueueService: ai.transcript-clean не инициализирован');
    const jobId = `transcript-clean_${meetingId}`;
    const payload: AiJobData = { meetingId, attempt: 1 };
    await q.add('transcript-clean', payload, { jobId });
    this.logger.debug(`enqueue ai.transcript-clean meeting=${meetingId}`);
  }

  async enqueueAnalyzeWithTemplate(
    meetingId: string,
    attempt: number,
    templateId?: string,
  ): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.ANALYZE);
    if (!q) throw new Error('AiQueueService: ai.analyze не инициализирован');
    const jobId = `${meetingId}:analyze:${attempt}`;
    const data: AiJobData = templateId
      ? { meetingId, attempt, templateId }
      : { meetingId, attempt };
    await q.add('analyze', data, { jobId });
    this.logger.debug(
      `enqueue ai.analyze meeting=${meetingId} attempt=${attempt} templateId=${templateId ?? '-'}`,
    );
  }

  async enqueueCardRollup(
    cardId: string,
    reason: CardRollupJobData['reason'] = 'analyze',
  ): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.CARD_ROLLUP);
    if (!q) throw new Error('AiQueueService: ai.card-rollup не инициализирован');
    const jobId = `rollup:card:${cardId}`;
    const payload: CardRollupJobData = { cardId, reason };
    await q.add('card-rollup', payload, { jobId });
    this.logger.debug(`enqueue ai.card-rollup card=${cardId} reason=${reason}`);
  }

  async enqueueCustomReport(
    reportId: string,
    meetingId: string,
    reason: 'create' | 'regenerate' = 'create',
  ): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.CUSTOM_REPORT);
    if (!q) throw new Error('AiQueueService: ai.custom-report не инициализирован');
    const jobId = `custom-report:${reportId}:${reason}`;
    const payload: CustomReportJobData = {
      meetingReportId: reportId,
      meetingId,
      reason,
      attempt: 1,
    };
    await q.add('custom-report', payload, { jobId });
    this.logger.debug(
      `enqueue ai.custom-report report=${reportId} meeting=${meetingId} reason=${reason}`,
    );
  }

  async enqueueClipRender(highlightId: string, attempt = 1): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.CLIP_RENDER);
    if (!q) throw new Error('AiQueueService: clip.render не инициализирован');
    const jobId = `clip:${highlightId}:${attempt}`;
    const payload: ClipRenderJobData = { highlightId, attempt };
    await q.add('clip-render', payload, { jobId });
    this.logger.debug(`enqueue clip.render highlight=${highlightId} attempt=${attempt}`);
  }

  async enqueueRecordingFaststart(meetingId: string): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(QUEUE_NAMES.RECORDING_FASTSTART);
    if (!q) throw new Error('AiQueueService: recording.faststart не инициализирован');
    const jobId = `faststart_${meetingId}`;
    const payload: AiJobData = { meetingId, attempt: 1 };
    await q.add('faststart', payload, { jobId });
    this.logger.debug(`enqueue recording.faststart meeting=${meetingId}`);
  }

  private async enqueue(queue: QueueName, meetingId: string, attempt: number): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(queue);
    if (!q) {
      throw new Error(`AiQueueService: очередь ${queue} не инициализирована`);
    }
    const stage = queue.split('.')[1] ?? queue;
    const jobId = `${meetingId}:${stage}:${attempt}`;
    const payload: AiJobData = { meetingId, attempt };
    await q.add(stage, payload, { jobId });
    this.logger.debug(`enqueue ${queue} meeting=${meetingId} attempt=${attempt}`);
  }
}
