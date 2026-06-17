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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { PublicDemo } from '../../common/guards/public-demo.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListConciergeConversationsQuerySchema,
  PostConciergeMessageBodySchema,
  UndoConciergeBodySchema,
  type ListConciergeConversationsQueryDto,
  type PostConciergeMessageBodyDto,
  type UndoConciergeBodyDto,
} from './dto/concierge.dto';
import { ConciergeQuotaService } from './services/concierge-quota.service';
import { ConciergeUndoLogService } from './services/concierge-undo-log.service';
import { ConciergeService } from './services/concierge.service';

@ApiTags('concierge')
@Controller('api/v1/concierge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ConciergeController {
  constructor(
    @Inject(ConciergeService) private readonly concierge: ConciergeService,
    @Inject(ConciergeQuotaService)
    private readonly quota: ConciergeQuotaService,
    @Inject(ConciergeUndoLogService)
    private readonly undoLog: ConciergeUndoLogService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('messages')
  @RequireSubscription()
  @PublicDemo()
  @ApiOperation({ summary: 'Отправить сообщение Concierge (SSE stream ответа)' })
  async stream(
    @Body(new ZodValidationPipe(PostConciergeMessageBodySchema))
    body: PostConciergeMessageBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {}
    }, this.cfg.concierge.sseHeartbeatSeconds * 1000);

    const baseUrl = this.deriveBaseUrl(req);
    const authCookie = req.headers.cookie ?? undefined;

    try {
      for await (const event of this.concierge.process({
        userMessage: body.userMessage,
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
        ...(body.pageContext ? { pageContext: body.pageContext } : {}),
        userId: user.id,
        tenantId: t,
        baseUrl,
        ...(authCookie ? { authCookie } : {}),
      })) {
        if (res.writableEnded) break;
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', code: 'stream_failure', message })}\n\n`);
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Post('messages/once')
  @RequireSubscription()
  @PublicDemo()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Polling fallback: одно сообщение → JSON c финальным ответом',
  })
  async once(
    @Body(new ZodValidationPipe(PostConciergeMessageBodySchema))
    body: PostConciergeMessageBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<{
    conversationId: string;
    messageId: string | null;
    text: string;
    citations?: unknown[];
    toolCalls: Array<{
      toolName: string;
      ok: boolean;
      status: number;
      undoLogId?: string;
    }>;
    quotaExceeded?: 'user_daily' | 'daily' | 'monthly';
    error?: { code: string; message: string };
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);

    const baseUrl = this.deriveBaseUrl(req);
    const authCookie = req.headers.cookie ?? undefined;

    let conversationId = body.conversationId ?? '';
    let finalText = '';
    let messageId: string | null = null;
    const toolCalls: Array<{
      toolName: string;
      ok: boolean;
      status: number;
      undoLogId?: string;
    }> = [];
    let quotaExceeded: 'user_daily' | 'daily' | 'monthly' | undefined;
    let error: { code: string; message: string } | undefined;
    let citations: unknown[] | undefined;

    for await (const event of this.concierge.process({
      userMessage: body.userMessage,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.pageContext ? { pageContext: body.pageContext } : {}),
      userId: user.id,
      tenantId: t,
      baseUrl,
      ...(authCookie ? { authCookie } : {}),
    })) {
      switch (event.type) {
        case 'started':
          conversationId = event.conversationId;
          break;
        case 'tool_result':
          toolCalls.push({
            toolName: event.toolName,
            ok: event.ok,
            status: event.status,
            ...(event.undoLogId ? { undoLogId: event.undoLogId } : {}),
          });
          break;
        case 'message':
          finalText = event.text;
          if (event.citations && event.citations.length > 0) {
            citations = event.citations;
          }
          break;
        case 'done':
          messageId = event.messageId;
          break;
        case 'quota_exceeded':
          quotaExceeded = event.scope;
          break;
        case 'error':
          error = { code: event.code, message: event.message };
          break;
        default:
          break;
      }
    }

    return {
      conversationId,
      messageId,
      text: finalText,
      ...(citations && citations.length > 0 ? { citations } : {}),
      toolCalls,
      ...(quotaExceeded ? { quotaExceeded } : {}),
      ...(error ? { error } : {}),
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Список диалогов пользователя' })
  async list(
    @Query(new ZodValidationPipe(ListConciergeConversationsQuerySchema))
    query: ListConciergeConversationsQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    items: Array<{
      id: string;
      startedAt: string;
      lastMessageAt: string | null;
      summary: string | null;
      archivedAt: string | null;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);

    const where = {
      tenantId: t,
      userId: user.id,
      ...(query.archived ? {} : { archivedAt: null }),
    };
    const [items, total] = await Promise.all([
      this.prisma.conciergeConversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.conciergeConversation.count({ where }),
    ]);
    return {
      items: items.map((c) => ({
        id: c.id,
        startedAt: c.startedAt.toISOString(),
        lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
        summary: c.summary,
        archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Диалог с сообщениями' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    id: string;
    summary: string | null;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
    }>;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);
    const conv = await this.prisma.conciergeConversation.findFirst({
      where: { id, tenantId: t, userId: user.id },
    });
    if (!conv) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'not_found', message: 'Диалог не найден' },
      });
    }
    const messages = await this.prisma.conciergeMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      id: conv.id,
      summary: conv.summary,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  @Post('undo/:logId')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Откатить выполненный tool call' })
  async undo(
    @Param('logId') logId: string,
    @Body(new ZodValidationPipe(UndoConciergeBodySchema))
    _body: UndoConciergeBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: boolean; status: number; message?: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);
    const baseUrl = this.deriveBaseUrl(req);
    const authCookie = req.headers.cookie ?? undefined;
    return this.undoLog.undo({
      logId,
      tenantId: t,
      userId: user.id,
      baseUrl,
      ...(authCookie ? { authCookie } : {}),
    });
  }

  @Get('quota')
  @ApiOperation({ summary: 'Текущая квота / использование Concierge' })
  async getQuota(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
  }> {
    const t = this.requireTenant(tenantId);
    await this.requireUse(user.id, t);
    return this.quota.getUsage(t);
  }

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

  private async requireUse(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj: 'concierge' as any,
      act: 'write',
      resourceOwnerId: userId,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для использования Concierge',
        },
      });
    }
  }

  private deriveBaseUrl(req: Request): string {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.headers.host ?? 'localhost:3000';
    return `${proto}://${host}`;
  }
}
