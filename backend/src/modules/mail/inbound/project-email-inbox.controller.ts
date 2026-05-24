import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  ProjectEmailInboxService,
  type ProjectEmailInboxDto,
} from './project-email-inbox.service';

/**
 * REST `/api/v1/projects/:id/email-inbox` (Tracker Phase 4, T5 — Email-to-task).
 *
 * Все эндпоинты — admin / owner проекта (`canWrite('project')` через RbacService).
 * `GET` достаточно canRead, чтобы member видел текущий адрес и логи.
 *
 * Сценарии:
 *  - `GET .../email-inbox` — текущий alias + последние 20 inbound писем.
 *  - `POST .../email-inbox/enable` — генерирует alias (если ещё нет) + включает.
 *  - `POST .../email-inbox/disable` — выключает (alias сохраняется).
 *  - `POST .../email-inbox/regenerate-alias` — новый alias (старый теряется).
 */
@ApiTags('tracker / projects / email-inbox')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProjectEmailInboxController {
  constructor(
    @Inject(ProjectEmailInboxService)
    private readonly svc: ProjectEmailInboxService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('projects/:id/email-inbox')
  @ApiOperation({
    summary: 'Получить email-inbox проекта + последние 20 inbound писем',
  })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectEmailInboxDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.get(id, t);
  }

  @Post('projects/:id/email-inbox/enable')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Включить email-inbox (генерирует alias, если ещё нет)',
  })
  async enable(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectEmailInboxDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.enable(id, t);
  }

  @Post('projects/:id/email-inbox/disable')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Выключить email-inbox (alias сохраняется на случай повторного включения)',
  })
  async disable(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectEmailInboxDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.disable(id, t);
  }

  @Post('projects/:id/email-inbox/regenerate-alias')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Сгенерировать новый alias (старый освобождается)',
  })
  async regenerate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProjectEmailInboxDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.regenerate(id, t);
  }

  // ── helpers ──

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение проекта' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут управлять email-inbox',
        },
      });
    }
  }
}
