import { Inject, Injectable } from '@nestjs/common';
import { type MeetingChapter, type Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ChaptersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<MeetingChapter | null> {
    return this.prisma.meetingChapter.findUnique({ where: { id } });
  }

  listByMeeting(meetingId: string): Promise<MeetingChapter[]> {
    return this.prisma.meetingChapter.findMany({
      where: { meetingId },
      orderBy: { order: 'asc' },
    });
  }

  countByMeeting(meetingId: string): Promise<number> {
    return this.prisma.meetingChapter.count({ where: { meetingId } });
  }

  create(data: {
    meetingId: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
    order: number;
  }): Promise<MeetingChapter> {
    return this.prisma.meetingChapter.create({ data });
  }

  update(id: string, data: Prisma.MeetingChapterUpdateInput): Promise<MeetingChapter> {
    return this.prisma.meetingChapter.update({ where: { id }, data });
  }

  delete(id: string): Promise<MeetingChapter> {
    return this.prisma.meetingChapter.delete({ where: { id } });
  }
}
