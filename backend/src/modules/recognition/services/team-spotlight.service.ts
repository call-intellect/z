import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { TeamSpotlightPersonDto, TeamSpotlightResponseDto } from '../dto/recognition.dto';

@Injectable()
export class TeamSpotlightService {
  private readonly logger = new Logger(TeamSpotlightService.name);

  private static readonly WINDOW_DAYS = 7;
  private static readonly TOP_LIMIT = 5;

  private static readonly THANKS_TYPES: ReadonlyArray<string> = [
    'thanks_comment',
    'thanks_helpfulness',
    'mention_helped',
  ];

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getWeekly(tenantId: string): Promise<TeamSpotlightResponseDto> {
    const to = new Date();
    const from = new Date(to.getTime() - TeamSpotlightService.WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const groupedRaw = await this.prisma.recognition.groupBy({
      by: ['toUserId'],
      where: {
        tenantId,
        createdAt: { gte: from, lte: to },
      },
      _count: { _all: true },
    });
    const grouped = groupedRaw
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, TeamSpotlightService.TOP_LIMIT * 3);

    if (grouped.length === 0) {
      return { period: { from: from.toISOString(), to: to.toISOString() }, persons: [] };
    }

    const userIds = grouped.map((g) => g.toUserId);
    const thanksGrouped = await this.prisma.recognition.groupBy({
      by: ['toUserId'],
      where: {
        tenantId,
        toUserId: { in: userIds },
        createdAt: { gte: from, lte: to },
        type: { in: [...TeamSpotlightService.THANKS_TYPES] },
      },
      _count: { _all: true },
    });
    const thanksByUser = new Map<string, number>();
    for (const t of thanksGrouped) {
      thanksByUser.set(t.toUserId, t._count._all);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const persons = await this.prisma.person.findMany({
      where: { tenantId, userId: { in: userIds }, deletedAt: null },
      select: { id: true, userId: true, name: true },
    });
    const personByUser = new Map<string, { id: string; name: string }>();
    for (const p of persons) {
      if (p.userId) personByUser.set(p.userId, { id: p.id, name: p.name });
    }

    const items: TeamSpotlightPersonDto[] = [];
    for (const g of grouped) {
      const u = userById.get(g.toUserId);
      if (!u) continue;
      const p = personByUser.get(g.toUserId) ?? null;
      const thanksReceived = thanksByUser.get(g.toUserId) ?? 0;
      items.push({
        personId: p?.id ?? null,
        userId: g.toUserId,
        name: p?.name ?? u.name,
        avatar: null,
        highlightReason: this.buildReason(g._count._all, thanksReceived),
        recognitionCount: g._count._all,
        thanksReceived,
      });
      if (items.length >= TeamSpotlightService.TOP_LIMIT) break;
    }

    return { period: { from: from.toISOString(), to: to.toISOString() }, persons: items };
  }

  private buildReason(recognitionCount: number, thanksReceived: number): string {
    if (thanksReceived > 0) {
      return `${this.plural(thanksReceived, 'благодарность', 'благодарности', 'благодарностей')} за помощь коллегам`;
    }
    return `${this.plural(recognitionCount, 'отметка', 'отметки', 'отметок')} за вклад на этой неделе`;
  }

  private plural(n: number, one: string, few: string, many: string): string {
    const abs = Math.abs(n) % 100;
    const lastTwo = abs;
    const lastOne = abs % 10;
    let word: string;
    if (lastTwo >= 11 && lastTwo <= 14) word = many;
    else if (lastOne === 1) word = one;
    else if (lastOne >= 2 && lastOne <= 4) word = few;
    else word = many;
    return `${n} ${word}`;
  }
}
