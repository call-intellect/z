import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  MeetingNotFoundError,
  NotAuthorizedError,
  QuotaExceededError,
} from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { AiQueueService } from '../ai-queue.service';

const USER_RETRY_LIMIT_PER_HOUR = 3;
const USER_RETRY_TTL_SECONDS = 3600;

export type RetryActor = 'user' | 'admin';

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
  ) {
    void this.meetings;
  }

  async retry(
    meetingId: string,
    actor: RetryActor,
    actorId?: string,
  ): Promise<{ stage: 'transcribe' | 'merge' | 'analyze' }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: { include: { tracks: { take: 1 } } },
        aiResult: true,
      },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);

    if (actor === 'user') {
      if (meeting.status !== 'failed') {
        throw new NotAuthorizedError('retry_only_from_failed');
      }
      if (actorId) {
        await this.checkUserRateLimit(actorId);
      }
    } else {
      if (meeting.status === 'ai_ready') {
        throw new NotAuthorizedError('retry_already_succeeded');
      }
    }

    const stage = this.detectStage(meeting);
    if (stage === null) {
      throw new NotAuthorizedError('nothing_to_retry');
    }

    const targetStatus =
      stage === 'transcribe'
        ? 'recording_ready'
        : stage === 'merge'
          ? 'transcription_processing'
          : 'transcription_ready';

    await this.prisma.$transaction([
      this.prisma.meeting.update({
        where: { id: meetingId },
        data: { status: targetStatus, failureReason: null },
      }),
      this.prisma.meetingEvent.create({
        data: {
          meetingId,
          eventType: `ai_retry:${stage}`,
          payload: {
            actor,
            ...(actorId ? { actorId } : {}),
          } as object,
        },
      }),
    ]);

    if (stage === 'transcribe') {
      await this.queue.enqueueTranscribe(meetingId, Date.now());
    } else if (stage === 'merge') {
      await this.queue.enqueueMerge(meetingId, Date.now());
    } else {
      await this.queue.enqueueAnalyze(meetingId, Date.now());
    }

    this.logger.log({ meetingId, actor, stage }, 'retry: AI-pipeline перезапущен');

    return { stage };
  }

  private detectStage(meeting: {
    transcript: { turns: unknown; tracks: { id: string }[] } | null;
    aiResult: { id: string } | null;
  }): 'transcribe' | 'merge' | 'analyze' | null {
    if (!meeting.transcript || meeting.transcript.tracks.length === 0) return 'transcribe';
    if (meeting.transcript.turns === null) return 'merge';
    if (!meeting.aiResult) return 'analyze';
    return null;
  }

  private async checkUserRateLimit(userId: string): Promise<void> {
    const key = `ai:retry:user:${userId}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, USER_RETRY_TTL_SECONDS);
    }
    if (count > USER_RETRY_LIMIT_PER_HOUR) {
      throw new QuotaExceededError('ai_retry', USER_RETRY_LIMIT_PER_HOUR);
    }
  }
}
