import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { PublicDemo } from '../../common/guards/public-demo.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CacheInvalidationService } from '../dialog-layer/services/cache-invalidation.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { ChatV2OrchestrationService } from './chat-v2.service';
import {
  ChatV2FeedbackBodySchema,
  ChatV2UsageStatsQuerySchema,
  type ChatV2FeedbackBody,
  type ChatV2UsageStatsDto,
  type ChatV2UsageStatsQuery,
} from './dto/chat-v2-feedback.dto';
import {
  ListChatV2ConversationsQuerySchema,
  PinChatV2ConversationBodySchema,
  PostChatV2MessageBodySchema,
  type ListChatV2ConversationsQueryDto,
  type PinChatV2ConversationBodyDto,
  type PostChatV2MessageBodyDto,
} from './dto/chat-v2.dto';
import { ChatV2FeedbackService } from './services/chat-v2-feedback.service';
import { ChatV2ConversationsService } from './services/conversations.service';

/**
 * SBA α-5 — REST API чат-v2.
 *
 *   POST   /api/v1/chat-v2/messages
 *   GET    /api/v1/chat-v2/conversations
 *   GET    /api/v1/chat-v2/conversations/:id
 *   POST   /api/v1/chat-v2/conversations/:id/pin
 *   POST   /api/v1/chat-v2/conversations/:id/archive
 *
 * RBAC: см. policy.csv §SBA α-5 — каждый пользователь видит только свои
 * диалоги; admin/owner видят все для отладки (read).
 */
@ApiTags('chat-v2')
@Controller('api/v1/chat-v2')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChatV2Controller {
  constructor(
    @Inject(ChatV2OrchestrationService)
    private readonly orchestration: ChatV2OrchestrationService,
    @Inject(ChatV2ConversationsService)
    private readonly conversations: ChatV2ConversationsService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(CacheInvalidationService)
    private readonly cacheInvalidation: CacheInvalidationService,
    @Inject(ChatV2FeedbackService)
    private readonly feedback: ChatV2FeedbackService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ──────────────────────────── messages ──────────────────────────────

  @Post('messages')
  @RequireSubscription()
  @PublicDemo()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Задать вопрос AI-чату (создаёт диалог если нет)' })
  async ask(
    @Body(new ZodValidationPipe(PostChatV2MessageBodySchema))
    body: PostChatV2MessageBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    conversationId: string;
    messageId: string;
    text: string;
    citations: unknown[];
    uncertaintyNote: string | null;
    mode: string;
    /** SBA α-5 dialog-layer — true, если ответ из AnswerCache. */
    cacheHit: boolean;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireWriteOwn(user.id, t);
    return this.orchestration.ask({
      tenantId: t,
      userId: user.id,
      question: body.question,
      conversationId: body.conversationId,
      mode: body.mode,
      scope: body.scope ?? 'org',
      scopeRefId: body.scopeRefId ?? null,
      asOf: body.asOf,
      channelKindOrigin: 'web',
    });
  }

  /**
   * §4 Ф1 (2026-06-11) — SSE-вариант ask: тот же ответ, но со стадиями
   * прогресса «Понимаю вопрос → Ищу в памяти → Пишу ответ», чтобы UI не
   * выглядел «зависшим». НЕ посимвольный стрим токенов (отдельный follow-up).
   * За kill-switch `CHAT_V2_STREAMING_ENABLED` (дефолт ON, Ship-On): при OFF —
   * 503 ДО SSE-заголовков, фронт откатывается на синхронный `/messages`.
   *
   * Формат событий:
   *   event: stage  data: { type:'stage', stage:'understanding'|'searching'|'writing' }
   *   event: done   data: { type:'done', conversationId, messageId, text, citations, uncertaintyNote, mode, cacheHit }
   *   event: error  data: { type:'error', code:'stream_failure', message }
   */
  @Post('messages/stream')
  @RequireSubscription()
  @PublicDemo()
  @ApiOperation({
    summary: 'Задать вопрос AI-чату со стадиями прогресса (SSE)',
  })
  async askStream(
    @Body(new ZodValidationPipe(PostChatV2MessageBodySchema))
    body: PostChatV2MessageBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Req() _req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWriteOwn(user.id, t);

    // Kill-switch: при OFF возвращаем 503 ДО установки SSE-заголовков, чтобы
    // фронт сделал fallback на синхронный POST /messages.
    if (!this.cfg.chatV2.streamingEnabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'streaming_disabled',
          message: 'Стриминг временно отключён',
        },
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        /* socket dead */
      }
    }, this.cfg.concierge.sseHeartbeatSeconds * 1000);

    try {
      const answer = await this.orchestration.ask({
        tenantId: t,
        userId: user.id,
        question: body.question,
        conversationId: body.conversationId,
        mode: body.mode,
        scope: body.scope ?? 'org',
        scopeRefId: body.scopeRefId ?? null,
        asOf: body.asOf,
        channelKindOrigin: 'web',
        onStage: (stage) => {
          if (!res.writableEnded) {
            res.write(`event: stage\n`);
            res.write(`data: ${JSON.stringify({ type: 'stage', stage })}\n\n`);
          }
        },
      });
      if (!res.writableEnded) {
        res.write(`event: done\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', ...answer })}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(
          `data: ${JSON.stringify({ type: 'error', code: 'stream_failure', message })}\n\n`,
        );
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  /**
   * SBA α-5 dialog-layer — очистить cache (AnswerCache + RetrievalCache)
   * по диалогу. Pessimistic flush по tenantId+userId (см. ТЗ §7).
   * Доступно владельцу диалога (RBAC: chat_v2_conversation/write на свой).
   */
  @Post('conversations/:id/clear-cache')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Очистить AnswerCache+RetrievalCache по диалогу (owner/admin)',
  })
  async clearCache(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    answerDeleted: number;
    retrievalDeleted: number;
  }> {
    const t = this.requireTenant(tenantId);
    // Проверка владения (404 если чужой). RBAC: используем тот же
    // chat_v2_conversation/write, что и для ask.
    const conv = await this.conversations.getById({
      tenantId: t,
      userId: user.id,
      conversationId: id,
    });
    await this.requireWriteOwn(user.id, t);
    return this.cacheInvalidation.invalidateUser(t, conv.userId);
  }

  // ──────────────────────── feedback (TZ-1 Ф5) ────────────────────────

  /**
   * TZ-1 Фаза 5 (daily-value-engine) — оценить ответ ассистента (палец
   * вверх/вниз). Upsert по (messageId, userId) с проверкой владения беседой.
   * Channel-agnostic: вызывается и из web, и из Telegram/in_app адаптеров —
   * НЕ web-only (нет @PublicDemo / web-гейта).
   */
  @Post('messages/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Оценить ответ ассистента (помог: вверх/вниз)' })
  async setFeedback(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChatV2FeedbackBodySchema))
    body: ChatV2FeedbackBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ messageId: string; helpful: 'up' | 'down' }> {
    const t = this.requireTenant(tenantId);
    return this.feedback.setFeedback({
      tenantId: t,
      userId: user.id,
      messageId: id,
      helpful: body.helpful,
      comment: body.comment,
    });
  }

  /**
   * TZ-1 Фаза 5 — снять оценку ответа. Проверка владения беседой.
   */
  @Delete('messages/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Снять оценку ответа ассистента' })
  async clearFeedback(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ messageId: string; cleared: boolean }> {
    const t = this.requireTenant(tenantId);
    return this.feedback.clearFeedback({
      tenantId: t,
      userId: user.id,
      messageId: id,
    });
  }

  /**
   * TZ-1 Фаза 5 — метрика чата за окно (несущая часть value-recap).
   * `scope='self'` (default) — мои диалоги (любой пользователь);
   * `scope='org'` — по всей Org (требует owner/coo).
   * helped-rate скрыт при rated<min; answeredWithCitation — grounding-proxy.
   */
  @Get('usage-stats')
  @ApiOperation({
    summary:
      'Метрика чата за окно (asked/answered/grounding-proxy/helped-rate). scope self|org',
  })
  async usageStats(
    @Query(new ZodValidationPipe(ChatV2UsageStatsQuerySchema))
    q: ChatV2UsageStatsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatV2UsageStatsDto> {
    const t = this.requireTenant(tenantId);
    if (q.scope === 'org') {
      const allowed = await this.rbac.canViewOperationsDashboard(user.id, t);
      if (!allowed) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'forbidden_role',
            message: 'Org-метрика чата доступна только owner/coo',
          },
        });
      }
    }
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from
      ? new Date(`${q.from}T00:00:00.000Z`)
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    const stats = await this.feedback.getChatUsageStats({
      tenantId: t,
      from,
      to,
      scope: q.scope,
      userId: q.scope === 'self' ? user.id : null,
    });
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      scope: q.scope,
      ...stats,
    };
  }

  // ──────────────────────────── conversations ────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'Список диалогов пользователя (master)' })
  async list(
    @Query(new ZodValidationPipe(ListChatV2ConversationsQuerySchema))
    query: ListChatV2ConversationsQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: unknown[]; total: number; page: number; limit: number }> {
    const t = this.requireTenant(tenantId);
    const result = await this.conversations.list({
      tenantId: t,
      userId: user.id,
      status: query.status,
      scope: query.scope,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items,
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Диалог с сообщениями (detail)' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<unknown> {
    const t = this.requireTenant(tenantId);
    return this.conversations.getById({
      tenantId: t,
      userId: user.id,
      conversationId: id,
    });
  }

  @Post('conversations/:id/pin')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Закрепить / открепить диалог' })
  async pin(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PinChatV2ConversationBodySchema))
    body: PinChatV2ConversationBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<unknown> {
    const t = this.requireTenant(tenantId);
    return this.conversations.setPinned({
      tenantId: t,
      userId: user.id,
      conversationId: id,
      pinned: body.pinned,
    });
  }

  @Post('conversations/:id/archive')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Архивировать диалог' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<unknown> {
    const t = this.requireTenant(tenantId);
    return this.conversations.archive({
      tenantId: t,
      userId: user.id,
      conversationId: id,
    });
  }

  // ──────────────────────────── helpers ──────────────────────────────

  private requireTenant(t: string | undefined): string {
    if (!t) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Не удалось определить организацию (X-Org-Id не передан)',
        },
      });
    }
    return t;
  }

  /**
   * RBAC проверка на свой ресурс. На α-5 — простая проверка членства в
   * Org; каждый member может задавать вопросы и видеть СВОИ диалоги.
   * Проверка ownership происходит в ConversationsService.requireOwnership.
   */
  private async requireWriteOwn(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chat_v2_conversation',
      act: 'write',
      resourceOwnerId: userId,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для chat-v2',
        },
      });
    }
  }
}
