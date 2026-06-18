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

  async enqueueUploadIngest(meetingId: string): Promise<{ jobId: string }> {
    const q = this.requireQueue(MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_INGEST);
    const jobId = `meeting_upload_ingest_${meetingId}`;
    const payload: MeetingUploadJobData = { meetingId };
    await q.add('upload-ingest', payload, { jobId });
    this.logger.debug(`enqueue meeting.upload-ingest meetingId=${meetingId} jobId=${jobId}`);
    return { jobId };
  }

  async enqueueUploadTranscribe(meetingId: string): Promise<{ jobId: string }> {
    const q = this.requireQueue(MEETING_UPLOAD_QUEUE_NAMES.UPLOAD_TRANSCRIBE);
    const jobId = `meeting_upload_transcribe_${meetingId}`;
    const payload: MeetingUploadJobData = { meetingId };
    await q.add('upload-transcribe', payload, { jobId });
    this.logger.debug(`enqueue meeting.upload-transcribe meetingId=${meetingId} jobId=${jobId}`);
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
