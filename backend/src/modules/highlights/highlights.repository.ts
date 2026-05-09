import { Inject, Injectable } from '@nestjs/common';
import { type MeetingHighlight, type Prisma, type RenderStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class HighlightsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<MeetingHighlight | null> {
    return this.prisma.meetingHighlight.findUnique({ where: { id } });
  }

  listByMeeting(meetingId: string): Promise<MeetingHighlight[]> {
    return this.prisma.meetingHighlight.findMany({
      where: { meetingId },
      orderBy: { startMs: 'asc' },
    });
  }

  countByMeeting(meetingId: string): Promise<number> {
    return this.prisma.meetingHighlight.count({ where: { meetingId } });
  }

  create(data: {
    meetingId: string;
    createdById: string;
    startMs: number;
    endMs: number;
    title: string;
    description: string | null;
  }): Promise<MeetingHighlight> {
    return this.prisma.meetingHighlight.create({ data });
  }

  update(
    id: string,
    data: Prisma.MeetingHighlightUpdateInput,
  ): Promise<MeetingHighlight> {
    return this.prisma.meetingHighlight.update({ where: { id }, data });
  }

  updateRenderStatus(
    id: string,
    status: RenderStatus,
    extras: { renderedMp4Key?: string | null; renderError?: string | null } = {},
  ): Promise<MeetingHighlight> {
    return this.prisma.meetingHighlight.update({
      where: { id },
      data: {
        renderStatus: status,
        ...(extras.renderedMp4Key !== undefined
          ? { renderedMp4Key: extras.renderedMp4Key }
          : {}),
        ...(extras.renderError !== undefined ? { renderError: extras.renderError } : {}),
      },
    });
  }

  delete(id: string): Promise<MeetingHighlight> {
    return this.prisma.meetingHighlight.delete({ where: { id } });
  }
}
