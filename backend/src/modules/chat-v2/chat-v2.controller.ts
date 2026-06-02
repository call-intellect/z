import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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
  ListChatV2ConversationsQuerySchema,
  PinChatV2ConversationBodySchema,
  PostChatV2MessageBodySchema,
  type ListChatV2ConversationsQueryDto,
  type PinChatV2ConversationBodyDto,
  type PostChatV2MessageBodyDto,
} from './dto/chat-v2.dto';
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
