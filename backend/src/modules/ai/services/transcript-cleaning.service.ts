import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';

import type { DialogTurn } from './prompts/common';

@Injectable()
export class TranscriptCleaningService {
  private readonly logger = new Logger(TranscriptCleaningService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getTranscript(args: { meetingId: string; userId: string; cleaned: boolean }): Promise<{
    turns: DialogTurn[];
    durationSeconds: number | null;
    cleaned: boolean;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: { transcript: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.ownerId !== args.userId) {
      throw new ForbiddenException('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t || t.turns === null) {
      throw new NotFoundException({ reason: 'transcript_not_ready' });
    }

    if (args.cleaned) {
      const status = t.cleaningStatus ?? 'not_started';
      if (status !== 'ready' || !t.cleanedS3Url) {
        throw new NotFoundException({
          reason: status === 'ready' ? 'not_started' : status,
        });
      }
      const cleanedDoc = await this.s3.getJson<{ turns?: DialogTurn[] }>(t.cleanedS3Url);
      return {
        turns: cleanedDoc?.turns ?? [],
        durationSeconds: t.totalDurationSeconds ?? null,
        cleaned: true,
      };
    }

    return {
      turns: (t.turns as unknown as DialogTurn[]) ?? [],
      durationSeconds: t.totalDurationSeconds ?? null,
      cleaned: false,
    };
  }

  async requestClean(args: {
    meetingId: string;
    userId: string;
  }): Promise<{ status: 'queued' } | { status: 'already_clean' }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: { transcript: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.ownerId !== args.userId) {
      throw new ForbiddenException('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t || !t.mergedS3Url) {
      throw new NotFoundException({ reason: 'transcript_not_ready' });
    }
    const status = t.cleaningStatus;
    if (status === 'ready' && t.cleanedS3Url) {
      return { status: 'already_clean' };
    }
    if (status === 'pending') {
      throw new ConflictException({ status: 'in_progress' });
    }
    await this.prisma.transcript.update({
      where: { id: t.id },
      data: { cleaningStatus: 'pending' },
    });
    await this.queue.enqueueTranscriptClean(args.meetingId);
    this.logger.log({ meetingId: args.meetingId }, 'transcript-clean: enqueued (manual)');
    return { status: 'queued' };
  }

  async setAuto(args: {
    orgId: string;
    userId: string;
    auto: boolean;
  }): Promise<{ auto: boolean }> {
    const membership = await this.prisma.membership.findFirst({
      where: { orgId: args.orgId, userId: args.userId, role: { in: ['owner', 'admin'] } },
    });
    if (!membership) {
      throw new ForbiddenException('only owner/admin can change org settings');
    }
    const updated = await this.prisma.org.update({
      where: { id: args.orgId },
      data: { transcriptCleaningAuto: args.auto },
      select: { transcriptCleaningAuto: true },
    });
    return { auto: updated.transcriptCleaningAuto };
  }
}
