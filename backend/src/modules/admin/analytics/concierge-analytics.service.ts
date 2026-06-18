import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

type Period = 'day' | 'week' | 'month';

export interface ConciergeOverview {
  period: Period;
  from: Date;
  to: Date;
  totalQuestions: number;
  noAnswerRate: number | null;
  avgLatencyMs: number | null;
  activeUsers: number;
  noAnswerCount: number;
  notes: {
    noAnswerRateIsHeuristic: boolean;
    avgLatencyAvailable: boolean;
  };
}

export interface TopQueryRow {
  query: string;
  count: number;
}

export interface NoAnswerRow {
  messageId: string;
  conversationId: string;
  tenantId: string | null;
  userId: string | null;
  userEmail: string | null;
  query: string;
  createdAt: Date;
}

const NO_ANSWER_MARKERS = [
  'не нашёл',
  'не нашел',
  'не смог найти',
  'нет данных',
  'недостаточно информации',
  'не знаю',
  'не уверен',
  'не могу ответить',
  'попробую позже',
  'информации не нашлось',
  'к сожалению, я не',
];

function normalizeQuery(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 300);
}

function isNoAnswer(content: string): boolean {
  const lc = content.toLowerCase();
  return NO_ANSWER_MARKERS.some((m) => lc.includes(m));
}

@Injectable()
export class ConciergeAnalyticsService {
  private readonly logger = new Logger(ConciergeAnalyticsService.name);
  private readonly hasMessageModel: boolean;
  private readonly hasConversationModel: boolean;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const p = this.prisma as unknown as Record<string, unknown>;
    this.hasMessageModel = Boolean(p['conciergeMessage']);
    this.hasConversationModel = Boolean(p['conciergeConversation']);
    if (!this.hasMessageModel || !this.hasConversationModel) {
      console.warn(
        '[ConciergeAnalyticsService] ConciergeMessage/ConciergeConversation не найдены в Prisma client — аналитика вернёт пустые данные.',
      );
    }
  }

  isAvailable(): boolean {
    return this.hasMessageModel && this.hasConversationModel;
  }

  async getOverview(period: Period): Promise<ConciergeOverview> {
    const { from, to } = this.periodRange(period);

    if (!this.hasMessageModel || !this.hasConversationModel) {
      return {
        period,
        from,
        to,
        totalQuestions: 0,
        noAnswerRate: null,
        avgLatencyMs: null,
        activeUsers: 0,
        noAnswerCount: 0,
        notes: {
          noAnswerRateIsHeuristic: true,
          avgLatencyAvailable: false,
        },
      };
    }

    const [totalQuestions, totalAssistantMessages, activeUsersGrouped] = await Promise.all([
      this.prisma.conciergeMessage.count({
        where: { role: 'user', createdAt: { gte: from, lt: to } },
      }),
      this.prisma.conciergeMessage.count({
        where: { role: 'assistant', createdAt: { gte: from, lt: to } },
      }),
      this.prisma.conciergeConversation.groupBy({
        by: ['userId'],
        where: { lastMessageAt: { gte: from, lt: to } },
      }),
    ]);

    let noAnswerRate: number | null = null;
    let noAnswerCount = 0;
    if (totalAssistantMessages > 0) {
      const assistant = await this.prisma.conciergeMessage.findMany({
        where: { role: 'assistant', createdAt: { gte: from, lt: to } },
        select: { content: true },
      });
      noAnswerCount = assistant.reduce((acc, m) => (isNoAnswer(m.content) ? acc + 1 : acc), 0);
      noAnswerRate = noAnswerCount / assistant.length;
    }

    const avgLatencyMs: number | null = null;

    return {
      period,
      from,
      to,
      totalQuestions,
      noAnswerRate,
      avgLatencyMs,
      activeUsers: activeUsersGrouped.length,
      noAnswerCount,
      notes: {
        noAnswerRateIsHeuristic: true,
        avgLatencyAvailable: false,
      },
    };
  }

  async getTopQueries(period: Period, limit: number): Promise<TopQueryRow[]> {
    if (!this.hasMessageModel) return [];
    const { from, to } = this.periodRange(period);

    const rows = await this.prisma.conciergeMessage.findMany({
      where: { role: 'user', createdAt: { gte: from, lt: to } },
      select: { content: true },
      take: 100_000,
    });

    const counts = new Map<string, number>();
    for (const r of rows) {
      const q = normalizeQuery(r.content);
      if (q.length < 3) continue;
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getNoAnswerList(period: Period, limit: number): Promise<NoAnswerRow[]> {
    if (!this.hasMessageModel || !this.hasConversationModel) return [];
    const { from, to } = this.periodRange(period);

    const PAGE = 200;
    const collected: NoAnswerRow[] = [];
    let skip = 0;

    while (collected.length < limit && skip < 5000) {
      const batch = await this.prisma.conciergeMessage.findMany({
        where: { role: 'assistant', createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        skip,
        select: {
          id: true,
          conversationId: true,
          content: true,
          createdAt: true,
        },
      });
      if (batch.length === 0) break;

      const matched = batch.filter((m) => isNoAnswer(m.content));
      if (matched.length === 0) {
        skip += PAGE;
        continue;
      }

      const convIds = Array.from(new Set(matched.map((m) => m.conversationId)));
      const conversations = await this.prisma.conciergeConversation.findMany({
        where: { id: { in: convIds } },
        select: { id: true, tenantId: true, userId: true },
      });
      const convById = new Map(conversations.map((c) => [c.id, c] as const));

      const userIds = Array.from(new Set(conversations.map((c) => c.userId).filter(Boolean)));
      const users = userIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true },
          })
        : [];
      const emailById = new Map(users.map((u) => [u.id, u.email] as const));

      for (const m of matched) {
        const conv = convById.get(m.conversationId);
        const prevUser = await this.prisma.conciergeMessage.findFirst({
          where: {
            conversationId: m.conversationId,
            role: 'user',
            createdAt: { lt: m.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        });
        collected.push({
          messageId: m.id,
          conversationId: m.conversationId,
          tenantId: conv?.tenantId ?? null,
          userId: conv?.userId ?? null,
          userEmail: conv?.userId ? (emailById.get(conv.userId) ?? null) : null,
          query: prevUser?.content ?? '(вопрос не найден)',
          createdAt: m.createdAt,
        });
        if (collected.length >= limit) break;
      }
      skip += PAGE;
    }

    return collected;
  }

  private periodRange(period: Period): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to);
    if (period === 'day') from.setUTCDate(from.getUTCDate() - 1);
    else if (period === 'week') from.setUTCDate(from.getUTCDate() - 7);
    else from.setUTCMonth(from.getUTCMonth() - 1);
    return { from, to };
  }
}
