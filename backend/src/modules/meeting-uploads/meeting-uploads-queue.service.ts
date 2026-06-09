import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import {
  MEETING_UPLOAD_JOB_OPTIONS,
  MEETING_UPLOAD_QUEUE_NAMES,
  type MeetingUploadJobData,
  type MeetingUploadQueueName,
} from './meeting-uploads.queues';

/**
 * HTTP/worker-side диспетчер очередей ручной загрузки встреч (ТЗ-5).
 * По образцу `CoreQueueService`/`AiQueueService`: на `onModuleInit` поднимает
 * `Queue` на каждое имя, enqueue-методы кладут тонкий payload с фиксированным
 * jobId (идемпотентность — повторный enqueue той же встречи не создаст дубль).
 *
 * jobId через `_` (не `:`) — BullMQ 5.x запрещает `:` в Custom Id
 * (см. Job.validateOptions). cuid/ulid сами по себе `:` не содержат.
 */
@Injectable()
export class MeetingUploadsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingUploadsQueueService.name);
  private queues: Map<MeetingUploadQueueName, Queue<MeetingUploadJobData>> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<MeetingUploadQueueName, Queue<MeetingUploadJobData>>();
    for (const name of Object.values(MEETING_UPLOAD_QUEUE_NAMES)) {
      map.set(
        name,
        new Queue<MeetingUploadJobData>(name, {
          connection,
          defaultJobOptions: MEETING_UPLOAD_JOB_OPTIONS,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`MeetingUploadsQueueService инициализирован (${map.size} очередей)`);
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

  /**
   * Постановка ingest-job (Ф2). Producer — `POST /meetings/:id/upload/complete`.
   * jobId = `meeting_upload_ingest_<meetingId>` → повторный complete = no-op
   * enqueue в окне дедупа BullMQ. Воркер дополнительно идемпотентен (FSM-guard).
   */
  async enqueueUploadIngest(meetingId: string): Promise<{ jobId: string }> {
    const q = this.requireQueue(MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_INGEST);
    const jobId = `meeting_upload_ingest_${meetingId}`;
    const payload: MeetingUploadJobData = { meetingId };
    await q.add('upload-ingest', payload, { jobId });
    this.logger.debug(`enqueue meeting.upload-ingest meetingId=${meetingId} jobId=${jobId}`);
    return { jobId };
  }

  /**
   * Постановка transcribe-job (Ф3). Producer — `MeetingUploadIngestWorker` в
   * конце успешного ingest'а. jobId = `meeting_upload_transcribe_<meetingId>`
   * → идемпотентно. Сам воркер этой очереди реализуется в Ф3.
   */
  async enqueueUploadTranscribe(meetingId: string): Promise<{ jobId: string }> {
    const q = this.requireQueue(MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_TRANSCRIBE);
    const jobId = `meeting_upload_transcribe_${meetingId}`;
    const payload: MeetingUploadJobData = { meetingId };
    await q.add('upload-transcribe', payload, { jobId });
    this.logger.debug(
      `enqueue meeting.upload-transcribe meetingId=${meetingId} jobId=${jobId}`,
    );
    return { jobId };
  }

  private requireQueue(name: MeetingUploadQueueName): Queue<MeetingUploadJobData> {
    const map = this.queues;
    if (!map) {
      throw new Error('MeetingUploadsQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(name);
    if (!q) {
      throw new Error(`MeetingUploadsQueueService: очередь ${name} не инициализирована`);
    }
    return q;
  }
}
