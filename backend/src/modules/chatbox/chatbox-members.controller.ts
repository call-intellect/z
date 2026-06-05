import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { ChatboxMembersService } from './chatbox-members.service';
import {
  ChatboxMemberLinkSchema,
  type ChatboxMemberDto,
  type ChatboxMemberLinkDto,
} from './dto/chatbox-members.dto';

/**
 * REST API членов ChatBox + ручной маппинг член → Person Коры
 * (ТЗ 2026-06-05, Фаза 9). Backend для админ-фронта связки.
 *
 *   - GET /api/v1/chatbox/members          — список членов с резолвом Person (read).
 *   - PUT /api/v1/chatbox/members/:id/link — привязать/снять связь с Person (manage).
 *
 * RBAC ресурс — `chatbox`. Формат ошибок `{ ok:false, error:{ code, message } }`
 * — по образцу `chatbox-integration.controller`.
 */
@ApiTags('chatbox')
@Controller('api/v1/chatbox/members')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChatboxMembersController {
  constructor(
    @Inject(ChatboxMembersService)
    private readonly service: ChatboxMembersService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список членов ChatBox с резолвом связанной Person' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatboxMemberDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.listMembers(t);
  }

  @Put(':id/link')
  @ApiOperation({ summary: 'Привязать члена ChatBox к Person Коры (или снять)' })
  async link(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChatboxMemberLinkSchema))
    body: ChatboxMemberLinkDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; member: ChatboxMemberDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    const member = await this.service.linkMember(t, id, body.personId);
    return { ok: true, member };
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
        error: {
          code: 'forbidden',
          message: 'Нет прав на чтение членов ChatBox',
        },
      });
    }
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'chatbox',
      act: 'manage',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Управлять связкой членов ChatBox может только владелец или администратор Org',
        },
      });
    }
  }
}
