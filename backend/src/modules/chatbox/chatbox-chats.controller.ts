import {
  BadRequestException,
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

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { ChatboxChatsService } from './chatbox-chats.service';
import {
  ChatboxChatsListQuerySchema,
  ChatboxMessagesQuerySchema,
  ChatboxSendMessageSchema,
  type ChatboxChatsListQueryDto,
  type ChatboxMessagesQueryDto,
  type ChatboxSendMessageDto,
  type ChatDetailDto,
  type ChatListItemDto,
  type ChatMessageDto,
} from './dto/chatbox-chats.dto';

/**
 * REST API просмотра чатов ChatBox + исходящей отправки ответа менеджера
 * (ТЗ 2026-06-05, Фаза 6). Backend для фронта Фаз 7/8.
 *
 *   - GET  /api/v1/chatbox/chats               — список (read).
 *   - GET  /api/v1/chatbox/chats/:id           — детали чата (read).
 *   - GET  /api/v1/chatbox/chats/:id/messages  — сообщения (read).
 *   - POST /api/v1/chatbox/chats/:id/messages  — отправить ответ (write).
 *
 * RBAC ресурс — `chatbox`. Privacy R12: чтение переписки доступно только
 * участникам организации (`Membership`), не «чистому» super_admin.
 */
@ApiTags('chatbox')
@Controller('api/v1/chatbox/chats')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChatboxChatsController {
  constructor(
    @Inject(ChatboxChatsService)
    private readonly service: ChatboxChatsService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список чатов ChatBox (фильтры + пагинация)' })
  async list(
    @Query(new ZodValidationPipe(ChatboxChatsListQuerySchema))
    query: ChatboxChatsListQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: ChatListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.requireConversationAccess(user.id, t);
    return this.service.listChats(t, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Детали чата ChatBox (сессии + мессенджеры)' })
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.requireConversationAccess(user.id, t);
    return this.service.getChat(t, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Сообщения чата ChatBox (пагинация)' })
  async messages(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ChatboxMessagesQuerySchema))
    query: ChatboxMessagesQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: ChatMessageDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.requireConversationAccess(user.id, t);
    return this.service.listMessages(t, id, query);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Отправить ответ менеджера в чат ChatBox' })
  async send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChatboxSendMessageSchema))
    body: ChatboxSendMessageDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; id: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.requireConversationAccess(user.id, t);
    const { id: messageId } = await this.service.sendMessage(t, id, body.text);
    return { ok: true, id: messageId };
  }

  @Post(':id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ручной запуск AI-анализа по чату (закрытые pending-сессии)',
  })
  async analyze(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; enqueued: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const { enqueued } = await this.service.analyzeChat(t, id);
    return { ok: true, enqueued };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chatbox',
      act: 'read',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на чтение чатов ChatBox' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chatbox',
      act: 'write',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет прав на отправку сообщений в ChatBox',
        },
      });
    }
  }

  /**
   * Privacy-гейт R12: чтение/отправка переписки доступны только участникам
   * организации. Исключает «чистого» super_admin без Membership в этой org.
   */
  private async requireConversationAccess(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const m = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId },
    });
    if (!m) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_conversation_access',
          message: 'Чтение переписки доступно только участникам организации',
        },
      });
    }
  }
}
