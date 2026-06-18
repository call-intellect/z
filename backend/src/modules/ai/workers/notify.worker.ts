import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type AiJobData, QUEUE_NAMES } from '../queues';

@Injectable()
export class NotifyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotifyWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.NOTIFY,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.NOTIFICATIONS, 'ai.notify', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.logger.log(`NotifyWorker запущен (${QUEUE_NAMES.NOTIFY})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    await this.prisma.meetingEvent.create({
      data: {
        meetingId,
        eventType: 'ai_notified',
        payload: {} as Prisma.InputJsonValue,
      },
    });
    this.logger.debug({ meetingId }, 'notify: записан MeetingEvent ai_notified');
  }
}
