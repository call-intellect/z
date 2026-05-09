import { Inject, Injectable } from '@nestjs/common';
import {
  type HighlightShare,
  type MeetingShare,
  type MeetingShareView,
  type Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Все запросы share/highlight-share + просмотры. Учёт просмотра — не транзакция:
 * `viewCount` — приблизительный, и переинкремент на гонке нас устроит
 * (ничего не зависит от строгой точности счётчика).
 */
@Injectable()
export class SharesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ─────────────────────────── meeting share ────────────────────────────

  findById(id: string): Promise<MeetingShare | null> {
    return this.prisma.meetingShare.findUnique({ where: { id } });
  }

  findByToken(token: string): Promise<MeetingShare | null> {
    return this.prisma.meetingShare.findUnique({ where: { token } });
  }

  listByMeeting(meetingId: string): Promise<MeetingShare[]> {
    return this.prisma.meetingShare.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: {
    token: string;
    meetingId: string;
    createdById: string;
    allowVideo: boolean;
    allowTranscript: boolean;
    allowTasks: boolean;
    allowChapters: boolean;
    allowChat: boolean;
    expiresAt: Date;
  }): Promise<MeetingShare> {
    return this.prisma.meetingShare.create({ data });
  }

  listRoomMessages(meetingId: string, limit = 1000) {
    return this.prisma.meetingRoomMessage.findMany({
      where: { meetingId },
      orderBy: { sentAt: 'asc' },
      take: limit,
      select: {
        id: true,
        authorName: true,
        content: true,
        sentAt: true,
      },
    });
  }

  revoke(id: string): Promise<MeetingShare> {
    return this.prisma.meetingShare.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async incrementView(
    shareId: string,
    view: { ipHash: string; userAgent: string | null; referrer: string | null },
    countView: boolean,
  ): Promise<MeetingShareView> {
    const ops: Array<Promise<unknown>> = [
      this.prisma.meetingShareView.create({
        data: {
          shareId,
          ipHash: view.ipHash,
          userAgent: view.userAgent,
          referrer: view.referrer,
        },
      }),
    ];
    if (countView) {
      ops.push(
        this.prisma.meetingShare.update({
          where: { id: shareId },
          data: {
            viewCount: { increment: 1 },
            lastViewedAt: new Date(),
          },
        }),
      );
    } else {
      // Без инкремента счётчика — но lastViewedAt всё равно обновим,
      // чтобы admin видел свежий просмотр.
      ops.push(
        this.prisma.meetingShare.update({
          where: { id: shareId },
          data: { lastViewedAt: new Date() },
        }),
      );
    }
    const results = await Promise.all(ops);
    return results[0] as MeetingShareView;
  }

  countDistinctViewToday(shareId: string, ipHash: string, since: Date): Promise<number> {
    return this.prisma.meetingShareView.count({
      where: { shareId, ipHash, viewedAt: { gte: since } },
    });
  }

  // ─────────────────────────── highlight share ──────────────────────────

  findHighlightShareById(id: string): Promise<HighlightShare | null> {
    return this.prisma.highlightShare.findUnique({ where: { id } });
  }

  findHighlightShareByToken(token: string): Promise<
    (HighlightShare & { highlight: { id: string; title: string; description: string | null; renderStatus: string; renderedMp4Key: string | null } }) | null
  > {
    return this.prisma.highlightShare.findUnique({
      where: { token },
      include: {
        highlight: {
          select: {
            id: true,
            title: true,
            description: true,
            renderStatus: true,
            renderedMp4Key: true,
          },
        },
      },
    });
  }

  listByHighlight(highlightId: string): Promise<HighlightShare[]> {
    return this.prisma.highlightShare.findMany({
      where: { highlightId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createHighlightShare(data: {
    token: string;
    highlightId: string;
    createdById: string;
    expiresAt: Date;
  }): Promise<HighlightShare> {
    return this.prisma.highlightShare.create({ data });
  }

  revokeHighlightShare(id: string): Promise<HighlightShare> {
    return this.prisma.highlightShare.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  incrementHighlightShareView(id: string): Promise<HighlightShare> {
    return this.prisma.highlightShare.update({
      where: { id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    });
  }

  /** Универсально: для тестов и сервисов, чтобы можно было замокать. */
  get raw(): PrismaService {
    return this.prisma;
  }

  /**
   * Тип `MeetingShareView` экспортируем для удобства потребителей.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  __types?: Prisma.MeetingShareViewWhereInput;
}
