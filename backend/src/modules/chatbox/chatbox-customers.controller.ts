import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
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

import { ChatboxCustomersService } from './chatbox-customers.service';
import {
  ChatboxCustomerLinkSchema,
  type ChatboxCustomerDto,
  type ChatboxCustomerLinkDto,
} from './dto/chatbox-customers.dto';

/**
 * REST API клиентов ChatBox + ручной маппинг клиент → Person Коры
 * (ТЗ 2026-06-11 chatbox-memory-finishing, Ф1). Клон `chatbox-members.controller`.
 *
 *   - GET /api/v1/chatbox/customers          — список клиентов с резолвом Person (read).
 *   - PUT /api/v1/chatbox/customers/:id/link — привязать/снять связь с Person (manage).
 *   - POST /api/v1/chatbox/customers/:id/create-person — создать Person из клиента (manage).
 *
 * RBAC ресурс — `chatbox` (read/manage), переиспользуем существующую политику
 * (новая не нужна). Формат ошибок `{ ok:false, error:{ code, message } }`.
 */
@ApiTags('chatbox')
@Controller('api/v1/chatbox/customers')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ChatboxCustomersController {
  constructor(
    @Inject(ChatboxCustomersService)
    private readonly service: ChatboxCustomersService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список клиентов ChatBox с резолвом связанной Person' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ChatboxCustomerDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.listCustomers(t);
  }

  @Put(':id/link')
  @ApiOperation({ summary: 'Привязать клиента ChatBox к Person Коры (или снять)' })
  async link(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChatboxCustomerLinkSchema))
    body: ChatboxCustomerLinkDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; customer: ChatboxCustomerDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    const customer = await this.service.linkCustomer(t, id, body.personId);
    return { ok: true, customer };
  }

  @Post(':id/create-person')
  @ApiOperation({
    summary: 'Создать сотрудника Коры из клиента ChatBox и связать с ним',
  })
  async createPerson(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; customer: ChatboxCustomerDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    const customer = await this.service.createPersonAndLink(t, user.id, id);
    return { ok: true, customer };
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
          message: 'Нет прав на чтение клиентов ChatBox',
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
            'Управлять связкой клиентов ChatBox может только владелец или администратор Org',
        },
      });
    }
  }
}
