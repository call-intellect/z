import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Admin-redesign Фаза 2 — `ConciergeAnalyticsService`.
 *
 * Read-only аналитика Concierge-чата (SBA γ-2) для UI Z-Admin раздела
 * «Аналитика → Concierge». Источник правды — модели `ConciergeMessage` +
 * `ConciergeConversation` из
 * [backend/prisma/schema.prisma](backend/prisma/schema.prisma).
 *
 * Если модель ConciergeMessage/ConciergeConversation отсутствует на
 * Prisma-client'е — все эндпоинты возвращают пустые/null-данные с
 * console.warn (см. ТЗ §2: «fallback при отсутствии модели чата»).
 *
 * Структура ConciergeMessage:
 *   id, conversationId, role ('user'|'assistant'|'tool'), content,
 *   toolCallsJson, createdAt.
 *
 * No-answer-rate: в γ-2 нет явного флага «не нашёл ответа». Используем
 * эвристику — assistant-сообщения с маркерами в content
 * («не нашёл», «нет данных», «не знаю», «не уверен», «попробую позже»).
 * Эвристика грубая, но даёт MVP-метрику; точный признак — TODO для γ+
 * (расширение схемы ConciergeMessage полем `noAnswer: Boolean`).
 *
 * `noAnswerRate` — null, если за период вообще не было assistant-сообщений
 * (UI рендерит «нет данных»).
 */

type Period = 'day' | 'week' | 'month';

export interface ConciergeOverview {
  period: Period;
  from: Date;
  to: Date;
  /** Всего вопросов от пользователей (role='user'). */
  totalQuestions: number;
  /**
   * Доля «не нашёл ответ» от всех assistant-ответов [0..1]. null —
   * за период не было ответов, считать долю не от чего.
   */
  noAnswerRate: number | null;
  /** Среднее latency в миллисекундах (null если нет данных). */
  avgLatencyMs: number | null;
  /** Уникальные пользователи (по `ConciergeConversation.userId`). */
  activeUsers: number;
  /**
   * Сколько assistant-ответов попало под эвристику «не нашёл ответ» за период.
   * Даёт честный hint в UI («X запросов») без отдельного запроса.
   */
  noAnswerCount: number;
  /**
   * TODO-флаги для UI: какие из метрик являются эвристиками / стабами.
   * UI может показать значок «(эвристика)».
   */
  notes: {
    noAnswerRateIsHeuristic: boolean;
    avgLatencyAvailable: boolean;
  };
}

export interface TopQueryRow {
  /** Нормализованная строка (lowercase + trim + collapse whitespace). */
  query: string;
  /** Количество появлений. */
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

/**
 * Маркеры «не нашёл ответ» — эвристика, см. JSDoc сервиса.
 * Список держим в одном месте для лёгкого расширения.
 */
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
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 300);
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

  /** Используется контроллером для отдачи 501, если чат-модели нет в проекте. */
  isAvailable(): boolean {
    return this.hasMessageModel && this.hasConversationModel;
  }

  // ─────────────────────────── public api ──────────────────────────────

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

    // 1) Totals.
    const [totalQuestions, totalAssistantMessages, activeUsersGrouped] =
      await Promise.all([
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

    // 2) no-answer-rate — выбираем все assistant-сообщения за период (с
    //    проекцией только content) и считаем долю по эвристике маркеров.
    //    Объём: на week — ожидаем < 50k записей, что приемлемо.
    let noAnswerRate: number | null = null;
    let noAnswerCount = 0;
    if (totalAssistantMessages > 0) {
      const assistant = await this.prisma.conciergeMessage.findMany({
        where: { role: 'assistant', createdAt: { gte: from, lt: to } },
        select: { content: true },
      });
      noAnswerCount = assistant.reduce(
        (acc, m) => (isNoAnswer(m.content) ? acc + 1 : acc),
        0,
      );
      noAnswerRate = noAnswerCount / assistant.length;
    }

    // 3) avgLatency — в текущей модели ConciergeMessage поля latency нет
    //    (TODO для γ+ — записывать latencyMs в toolCallsJson или отдельным
    //    полем). Возвращаем null + флаг.
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

    // Берём все user-сообщения за период (с content), нормализуем и считаем
    // частоты в памяти. На месячных объёмах < 50k записей это OK.
    const rows = await this.prisma.conciergeMessage.findMany({
      where: { role: 'user', createdAt: { gte: from, lt: to } },
      select: { content: true },
      // Hard cap чтобы не положить сервер на аномальных Org.
      take: 100_000,
    });

    const counts = new Map<string, number>();
    for (const r of rows) {
      const q = normalizeQuery(r.content);
      if (q.length < 3) continue; // отсекаем мусор
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async getNoAnswerList(
    period: Period,
    limit: number,
  ): Promise<NoAnswerRow[]> {
    if (!this.hasMessageModel || !this.hasConversationModel) return [];
    const { from, to } = this.periodRange(period);

    // Выбираем последние assistant-сообщения с маркерами no-answer; для
    // каждого вытягиваем user-вопрос (предыдущее сообщение в той же
    // conversation) + email пользователя.
    //
    // Стратегия: пагинируемся батчами по 200 assistant'ов в order desc, для
    // каждого фильтруем по маркеру и собираем contextual user-вопрос.
    // Останавливаемся, когда набрали limit или закончились.
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

      // Получаем conversations (для tenant + userId).
      const convIds = Array.from(new Set(matched.map((m) => m.conversationId)));
      const conversations = await this.prisma.conciergeConversation.findMany({
        where: { id: { in: convIds } },
        select: { id: true, tenantId: true, userId: true },
      });
      const convById = new Map(conversations.map((c) => [c.id, c] as const));

      // Получаем user-email'ы.
      const userIds = Array.from(
        new Set(conversations.map((c) => c.userId).filter(Boolean)),
      );
      const users = userIds.length
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true },
          })
        : [];
      const emailById = new Map(users.map((u) => [u.id, u.email] as const));

      // Для каждого assistant-сообщения находим предыдущий user-question.
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
          userEmail: conv?.userId ? emailById.get(conv.userId) ?? null : null,
          query: prevUser?.content ?? '(вопрос не найден)',
          createdAt: m.createdAt,
        });
        if (collected.length >= limit) break;
      }
      skip += PAGE;
    }

    return collected;
  }

  // ─────────────────────────── private ─────────────────────────────────

  private periodRange(period: Period): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to);
    if (period === 'day') from.setUTCDate(from.getUTCDate() - 1);
    else if (period === 'week') from.setUTCDate(from.getUTCDate() - 7);
    else from.setUTCMonth(from.getUTCMonth() - 1);
    return { from, to };
  }
}
