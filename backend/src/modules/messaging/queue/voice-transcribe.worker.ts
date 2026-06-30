import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { VoxService } from '../../ai/services/vox.service';
import { extractKeyFromUrl } from '../../recordings/s3-keys';
import { S3Service } from '../../recordings/s3.service';

import { ChatIngestQueueService } from './chat-ingest.queue.service';
import { VOICE_TRANSCRIBE_QUEUE, type VoiceTranscribeJobData } from './voice-transcribe.queue';

@Injectable()
export class VoiceTranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceTranscribeWorker.name);
  private worker: Worker<VoiceTranscribeJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ChatIngestQueueService) private readonly chatIngestQueue: ChatIngestQueueService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<VoiceTranscribeJobData>(
      VOICE_TRANSCRIBE_QUEUE,
      async (job) => this.transcribe(job.data.messageId),
      { connection: this.redis.client, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, messageId: job?.data.messageId, err: err.message },
        'VoiceTranscribeWorker: job failed',
      );
    });
    this.logger.log('VoiceTranscribeWorker запущен');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async transcribe(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        voiceUrl: true,
        voiceTranscript: true,
      },
    });
    if (!message) {
      this.logger.debug({ messageId }, 'voice-transcribe: Message не найден — skip');
      return;
    }
    if (!message.voiceUrl) {
      this.logger.debug({ messageId }, 'voice-transcribe: нет voiceUrl — skip');
      return;
    }
    if (message.voiceTranscript && message.voiceTranscript.trim().length > 0) {
      this.logger.debug({ messageId }, 'voice-transcribe: транскрипт уже есть — skip');
      return;
    }

    const audioKey = extractKeyFromUrl(message.voiceUrl, this.cfg.s3.bucket);
    if (!audioKey) {
      this.logger.warn({ messageId, voiceUrl: message.voiceUrl }, 'voice-transcribe: пустой audio key');
      return;
    }

    const audio = await this.s3.getObject(audioKey);
    const { taskId } = await this.vox.submit(audio, {});
    const result = await this.vox.poll(taskId, {
      intervalMs: this.cfg.ai.vox.pollIntervalMs,
      maxAttempts: this.cfg.ai.vox.pollMaxAttempts,
    });

    const transcript = result.transcriptText.trim();
    await this.prisma.message.update({
      where: { id: messageId },
      data: { voiceTranscript: transcript },
    });

    this.logger.debug(
      { messageId, textLength: transcript.length, durationSeconds: result.durationSeconds },
      'voice-transcribe: транскрипт записан',
    );

    if (transcript.length === 0) {
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: { feedsGraph: true },
    });
    if (conversation?.feedsGraph) {
      try {
        await this.chatIngestQueue.enqueue(messageId);
      } catch (err) {
        this.logger.warn(
          { messageId, err: err instanceof Error ? err.message : String(err) },
          'voice-transcribe: chat.ingest re-enqueue не удался',
        );
      }
    }
  }
}
