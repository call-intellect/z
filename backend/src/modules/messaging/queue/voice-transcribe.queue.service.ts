import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

import {
  VOICE_TRANSCRIBE_QUEUE,
  type VoiceTranscribeJobData,
  voiceTranscribeJobId,
} from './voice-transcribe.queue';

@Injectable()
export class VoiceTranscribeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceTranscribeQueueService.name);
  private queue: Queue<VoiceTranscribeJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<VoiceTranscribeJobData>(VOICE_TRANSCRIBE_QUEUE, {
      connection: this.redis.client,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
      },
    });
    this.logger.log(`VoiceTranscribeQueueService: очередь ${VOICE_TRANSCRIBE_QUEUE} готова`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close().catch(() => undefined);
      this.queue = null;
    }
  }

  async enqueue(messageId: string): Promise<void> {
    const q = this.requireQueue();
    await q.add('transcribe', { messageId }, { jobId: voiceTranscribeJobId(messageId) });
  }

  private requireQueue(): Queue<VoiceTranscribeJobData> {
    if (!this.queue) {
      throw new Error('VoiceTranscribeQueueService: enqueue до onModuleInit');
    }
    return this.queue;
  }
}
