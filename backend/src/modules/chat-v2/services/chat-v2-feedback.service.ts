import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  buildChatUsageStats,
  DEFAULT_CHAT_FEEDBACK_MIN_RATED,
  type ChatUsageStats,
} from './chat-usage-stats.scoring';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — ChatV2FeedbackService.
 *
 * Несущая часть value-recap: оценка «помог ли ответ» (палец вверх/вниз) на
 * сообщениях AI-чата + агрегатор метрики чата (`getChatUsageStats`).
 *
 *   - upsert/clear фидбека по (messageId, userId) с проверкой владения беседой
 *     (channel-agnostic: оценка собирается и из web, и из Telegram/in_app).
 *   - `getChatUsageStats(tenantId, from, to)` — asked/answered/
 *     answeredWithCitation (grounding-proxy, type-guard массива citations) +
 *     rated/helpedUp + helped-rate (скрыт при rated<min) + дедуп ретраев <30с.
 *
 * Честность (Р6/Р7): helped-rate = helpedUp/rated (НЕ /answered);
 * answeredWithCitation — grounding-proxy, НЕ «дефлекция».
 */
@Injectable()
export class ChatV2FeedbackService {
  private readonly logger = new Logger(ChatV2FeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ──────────────────────────── feedback (write) ──────────────────────

  /**
   * Поставить/обновить оценку assistant-сообщения. Идемпотентно по
   * (messageId, userId) — повторный вызов перезаписывает. Проверяет:
   *   - kill-switch `chat_v2.feedback.enabled`;
   *   - сообщение существует, принадлежит беседе той же Org;
   *   - беседа принадлежит пользователю (владение);
   *   - оценивается только assistant-сообщение (на user-сообщение нельзя).
   */
  async setFeedback(args: {
    tenantId: string;
    userId: string;
    messageId: string;
    helpful: 'up' | 'down';
    comment?: string;
  }): Promise<{ messageId: string; helpful: 'up' | 'down' }> {
    await this.assertEnabled();
    await this.assertMessageOwnership({
      tenantId: args.tenantId,
      userId: args.userId,
      messageId: args.messageId,
      requireAssistant: true,
    });

    await this.prisma.chatV2Message.update({
      where: { id: args.messageId },
      data: {
        helpful: args.helpful,
        helpfulAt: new Date(),
        helpfulComment:
          typeof args.comment === 'string' && args.comment.trim().length > 0
            ? args.comment.trim().slice(0, 2_000)
            : null,
      },
    });
    this.metrics.incChatV2Feedback({ reaction: args.helpful });
    return { messageId: args.messageId, helpful: args.helpful };
  }

  /** Снять оценку сообщения (вернуть в NULL). Проверяет владение. */
  async clearFeedback(args: {
    tenantId: string;
    userId: string;
    messageId: string;
  }): Promise<{ messageId: string; cleared: boolean }> {
    await this.assertMessageOwnership({
      tenantId: args.tenantId,
      userId: args.userId,
      messageId: args.messageId,
      requireAssistant: false,
    });
    await this.prisma.chatV2Message.update({
      where: { id: args.messageId },
      data: { helpful: null, helpfulAt: null, helpfulComment: null },
    });
    return { messageId: args.messageId, cleared: true };
  }

  // ──────────────────────────── usage stats (read) ────────────────────

  /**
   * Агрегатор метрики чата за окно. `scope='self'` ограничивает по
   * `conversation.userId`; `scope='org'` — по всей Org. Type-guard citations
   * (jsonb_typeof='array' AND jsonb_array_length>0). Дедуп user-ретраев <Nс.
   *
   * Используется и эндпоинтом `/chat-v2/usage-stats`, и `ValueRecapService`.
   */
  async getChatUsageStats(args: {
    tenantId: string;
    from: Date;
    to: Date;
    scope?: 'self' | 'org';
    /** Обязателен при scope='self'. */
    userId?: string | null;
  }): Promise<ChatUsageStats> {
    const minRated = await this.resolveMinRated();
    const retryDedupSeconds = await this.resolveRetryDedupSeconds();
    const scope = args.scope ?? 'org';

    // Фильтр по владельцу беседы для self-scope (через join к conversation).
    const selfUserId = scope === 'self' ? (args.userId ?? null) : null;
    if (scope === 'self' && !selfUserId) {
      // self-scope без userId → пустая статистика (не светим чужое).
      return buildChatUsageStats(
        { asked: 0, answered: 0, answeredWithCitation: 0, rated: 0, helpedUp: 0 },
        minRated,
      );
    }

    // Один проход $queryRaw: type-guard citations + дедуп ретраев в SQL.
    // Дедуп: user-сообщения одного диалога в окне < retryDedupSeconds друг от
    // друга считаются ОДНИМ вопросом (берём первое; lag по createdAt).
    const userFilter = selfUserId
      ? Prisma.sql`AND c."userId" = ${selfUserId}`
      : Prisma.empty;

    type CountRow = {
      asked: bigint | number;
      answered: bigint | number;
      answered_with_citation: bigint | number;
      rated: bigint | number;
      helped_up: bigint | number;
    };

    const rows = await this.prisma.$queryRaw<CountRow[]>`
      WITH user_msgs AS (
        SELECT
          m."id",
          m."conversationId",
          m."createdAt",
          EXTRACT(EPOCH FROM (
            m."createdAt" - LAG(m."createdAt") OVER (
              PARTITION BY m."conversationId" ORDER BY m."createdAt"
            )
          )) AS gap_seconds
        FROM "ChatV2Message" m
        JOIN "ChatV2Conversation" c ON c."id" = m."conversationId"
        WHERE c."tenantId" = ${args.tenantId}
          AND m."role" = 'user'
          AND m."createdAt" >= ${args.from}
          AND m."createdAt" <= ${args.to}
          ${userFilter}
      ),
      asked_dedup AS (
        SELECT COUNT(*)::bigint AS cnt
        FROM user_msgs
        WHERE gap_seconds IS NULL OR gap_seconds >= ${retryDedupSeconds}
      ),
      assistant_msgs AS (
        SELECT
          m."citations",
          m."helpful"
        FROM "ChatV2Message" m
        JOIN "ChatV2Conversation" c ON c."id" = m."conversationId"
        WHERE c."tenantId" = ${args.tenantId}
          AND m."role" = 'assistant'
          AND m."createdAt" >= ${args.from}
          AND m."createdAt" <= ${args.to}
          ${userFilter}
      )
      SELECT
        (SELECT cnt FROM asked_dedup) AS asked,
        COUNT(*)::bigint AS answered,
        COUNT(*) FILTER (
          WHERE "citations" IS NOT NULL
            AND CASE
                  WHEN jsonb_typeof("citations") = 'array'
                  THEN jsonb_array_length("citations") > 0
                  ELSE false
                END
        )::bigint AS answered_with_citation,
        COUNT(*) FILTER (WHERE "helpful" IS NOT NULL)::bigint AS rated,
        COUNT(*) FILTER (WHERE "helpful" = 'up')::bigint AS helped_up
      FROM assistant_msgs
    `;

    const row = rows[0];
    const raw = {
      asked: toNum(row?.asked),
      answered: toNum(row?.answered),
      answeredWithCitation: toNum(row?.answered_with_citation),
      rated: toNum(row?.rated),
      helpedUp: toNum(row?.helped_up),
    };

    // Метрики (по итогам агрегации, без cardinality-взрыва).
    this.metrics.setChatAnsweredWithCitation({
      mode: scope,
      value: raw.answeredWithCitation,
    });

    return buildChatUsageStats(raw, minRated);
  }

  // ──────────────────────────── helpers ───────────────────────────────

  /**
   * Проверка владения: сообщение → беседа (той же Org) → пользователь-владелец.
   * 404 (а не 403), чтобы не разглашать существование чужого сообщения.
   */
  private async assertMessageOwnership(args: {
    tenantId: string;
    userId: string;
    messageId: string;
    requireAssistant: boolean;
  }): Promise<void> {
    const msg = await this.prisma.chatV2Message.findUnique({
      where: { id: args.messageId },
      select: {
        role: true,
        conversation: { select: { tenantId: true, userId: true } },
      },
    });
    if (
      !msg ||
      !msg.conversation ||
      msg.conversation.tenantId !== args.tenantId ||
      msg.conversation.userId !== args.userId
    ) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'message_not_found', message: 'Сообщение не найдено' },
      });
    }
    if (args.requireAssistant && msg.role !== 'assistant') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_assistant_message',
          message: 'Оценивать можно только ответ ассистента',
        },
      });
    }
  }

  private async assertEnabled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'chat_v2.feedback.enabled',
      'CHAT_V2_FEEDBACK_ENABLED',
      true,
    );
    if (!enabled) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'feedback_disabled',
          message: 'Оценка ответов временно отключена',
        },
      });
    }
  }

  private async resolveMinRated(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'chat_v2.feedback.min_rated',
      'CHAT_V2_FEEDBACK_MIN_RATED',
      DEFAULT_CHAT_FEEDBACK_MIN_RATED,
    );
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? Math.floor(v)
      : DEFAULT_CHAT_FEEDBACK_MIN_RATED;
  }

  private async resolveRetryDedupSeconds(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'chat_v2.feedback.retry_dedup_seconds',
      'CHAT_V2_FEEDBACK_RETRY_DEDUP_SECONDS',
      30,
    );
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? Math.floor(v)
      : 30;
  }
}

function toNum(v: bigint | number | undefined | null): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}
