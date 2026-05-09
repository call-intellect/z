import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Глобальный поиск для `⌘K` командной палитры.
 *
 * Реализация — Postgres ILIKE по relevant-полям. Все запросы owner-scoped.
 * ts_vector / pg_trgm / триграммные индексы — vNext, если потребуется.
 */
export type SearchTypeKey = 'cards' | 'meetings' | 'tasks';

export interface SearchResultCardItem {
  id: string;
  name: string;
  kind: string;
  lastMeetingAt: string | null;
  meetingCount: number;
}

export interface SearchResultMeetingItem {
  id: string;
  title: string;
  type: string;
  cardId: string | null;
  createdAt: string;
}

export interface SearchResultTaskItem {
  id: string;
  title: string;
  status: string;
  meetingId: string;
}

export interface SearchResult {
  cards: SearchResultCardItem[];
  meetings: SearchResultMeetingItem[];
  tasks: SearchResultTaskItem[];
}

@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(args: {
    userId: string;
    query: string;
    types: SearchTypeKey[];
    limit: number;
  }): Promise<SearchResult> {
    const limit = Math.min(50, Math.max(1, args.limit));
    const q = args.query.trim();
    if (!q) {
      return { cards: [], meetings: [], tasks: [] };
    }

    const wantsCards = args.types.includes('cards');
    const wantsMeetings = args.types.includes('meetings');
    const wantsTasks = args.types.includes('tasks');

    const [cards, meetings, tasks] = await Promise.all([
      wantsCards ? this.searchCards(args.userId, q, limit) : Promise.resolve([]),
      wantsMeetings
        ? this.searchMeetings(args.userId, q, limit)
        : Promise.resolve([]),
      wantsTasks ? this.searchTasks(args.userId, q, limit) : Promise.resolve([]),
    ]);

    return { cards, meetings, tasks };
  }

  private async searchCards(
    userId: string,
    q: string,
    limit: number,
  ): Promise<SearchResultCardItem[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { contactName: { contains: q, mode: 'insensitive' } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { lastMeetingAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        kind: true,
        lastMeetingAt: true,
        meetingCount: true,
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      lastMeetingAt: c.lastMeetingAt?.toISOString() ?? null,
      meetingCount: c.meetingCount,
    }));
  }

  private async searchMeetings(
    userId: string,
    q: string,
    limit: number,
  ): Promise<SearchResultMeetingItem[]> {
    const rows = await this.prisma.meeting.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        title: { contains: q, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        type: true,
        cardId: true,
        createdAt: true,
      },
    });
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      cardId: m.cardId,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async searchTasks(
    userId: string,
    q: string,
    limit: number,
  ): Promise<SearchResultTaskItem[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        userId,
        title: { contains: q, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, status: true, meetingId: true },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      meetingId: t.meetingId,
    }));
  }
}
