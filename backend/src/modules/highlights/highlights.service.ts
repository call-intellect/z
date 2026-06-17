import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MeetingHighlight } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

import { ClipRenderService } from './clip-render.service';
import type { CreateHighlightDto } from './dto/create-highlight.dto';
import type { UpdateHighlightDto } from './dto/update-highlight.dto';
import { HighlightsRepository } from './highlights.repository';

@Injectable()
export class HighlightsService {
  private readonly logger = new Logger(HighlightsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HighlightsRepository) private readonly repo: HighlightsRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ClipRenderService) private readonly clipRender: ClipRenderService,
  ) {}

  async listByMeeting(meetingId: string, userId: string): Promise<MeetingHighlight[]> {
    await this.assertMeetingOwner(meetingId, userId);
    return this.repo.listByMeeting(meetingId);
  }

  async create(
    meetingId: string,
    userId: string,
    dto: CreateHighlightDto,
  ): Promise<MeetingHighlight> {
    const meeting = await this.assertMeetingOwner(meetingId, userId);

    const maxDurationMs = this.cfg.workspace.clipMaxDurationSeconds * 1000;
    if (dto.endMs - dto.startMs > maxDurationMs) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'clip_too_long',
          message: `Длительность клипа не должна превышать ${this.cfg.workspace.clipMaxDurationSeconds} секунд`,
        },
      });
    }
    if (meeting.durationMs !== null && dto.endMs > meeting.durationMs) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'clip_out_of_bounds',
          message: 'Конец клипа выходит за длительность встречи',
        },
      });
    }

    const max = this.cfg.workspace.maxHighlightsPerMeeting;
    const count = await this.repo.countByMeeting(meetingId);
    if (count >= max) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'highlights_limit_reached',
          message: `Достигнут лимит клипов на встречу (${max})`,
        },
      });
    }

    return this.repo.create({
      meetingId,
      createdById: userId,
      startMs: dto.startMs,
      endMs: dto.endMs,
      title: dto.title,
      description: dto.description ?? null,
    });
  }

  async update(id: string, userId: string, dto: UpdateHighlightDto): Promise<MeetingHighlight> {
    const highlight = await this.repo.findById(id);
    if (!highlight) throw new NotFoundException('highlight_not_found');
    await this.assertMeetingOwner(highlight.meetingId, userId);
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const highlight = await this.repo.findById(id);
    if (!highlight) throw new NotFoundException('highlight_not_found');
    await this.assertMeetingOwner(highlight.meetingId, userId);
    await this.repo.delete(id);
  }

  async startRender(
    id: string,
    userId: string,
  ): Promise<
    | { status: 'queued'; renderStatus: 'queued' }
    | { status: 'ready'; url: string; expiresAt: string }
  > {
    const highlight = await this.repo.findById(id);
    if (!highlight) throw new NotFoundException('highlight_not_found');
    await this.assertMeetingOwner(highlight.meetingId, userId);
    return this.clipRender.startRender(highlight, userId);
  }

  async getDownloadUrl(id: string, userId: string): Promise<{ url: string; expiresAt: string }> {
    const highlight = await this.repo.findById(id);
    if (!highlight) throw new NotFoundException('highlight_not_found');
    await this.assertMeetingOwner(highlight.meetingId, userId);
    return this.clipRender.getDownloadUrl(highlight);
  }

  private async assertMeetingOwner(
    meetingId: string,
    userId: string,
  ): Promise<{ id: string; ownerId: string; durationMs: number | null; deletedAt: Date | null }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, ownerId: true, durationMs: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException('meeting_not_found');
    }
    return meeting;
  }
}
