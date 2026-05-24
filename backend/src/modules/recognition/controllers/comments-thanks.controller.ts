import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
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
import type { ToggleThanksResponseDto } from '../dto/recognition.dto';
import { CommentsThanksService } from '../services/comments-thanks.service';

/**
 * Wave 2 — Comments Thanks REST API.
 *
 *   POST  /api/v1/issues/comments/:id/thanks  — toggle «спасибо».
 *   GET   /api/v1/issues/comments/:id/thanks  — текущее состояние.
 *
 * Изолировано от `tracker/comments.controller.ts` (см. ТЗ §4), чтобы не ломать
 * существующую функциональность. Ресурс RBAC — `issue` (комментарий = дочерний
 * ресурс задачи; для write-action достаточно canWrite на 'issue').
 */
@ApiTags('recognition / comments-thanks')
@ApiBearerAuth()
@Controller('api/v1/issues/comments')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CommentsThanksController {
  constructor(
    @Inject(CommentsThanksService)
    private readonly svc: CommentsThanksService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post(':id/thanks')
  @ApiOperation({
    summary: 'Toggle «спасибо» за комментарий (idempotent)',
  })
  async toggleThanks(
    @Param('id') commentId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ToggleThanksResponseDto> {
    const t = this.requireTenant(tenantId);
    const userId = this.svc.ensureUser(user?.id);
    await this.requireWriteIssue(userId, t);
    return this.svc.toggle(commentId, t, userId);
  }

  @Get(':id/thanks')
  @ApiOperation({ summary: 'Получить state «спасибо» по комментарию' })
  async readThanks(
    @Param('id') commentId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ToggleThanksResponseDto> {
    const t = this.requireTenant(tenantId);
    const userId = this.svc.ensureUser(user?.id);
    await this.requireReadIssue(userId, t);
    return this.svc.readState(commentId, t, userId);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireReadIssue(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWriteIssue(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на «спасибо» (нужны права комментирования)',
        },
      });
    }
  }
}
