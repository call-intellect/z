import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  ListProactiveQuerySchema,
  type ListProactiveQuery,
  type ListProactiveResponseDto,
  type ProactiveNotificationDto,
} from '../dto/proactive-notification.dto';
import { ProactiveNotificationsService } from '../services/proactive-notifications.service';

@ApiTags('me-proactive-notifications')
@Controller('api/v1/me/proactive-notifications')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyProactiveNotificationsController {
  constructor(
    @Inject(ProactiveNotificationsService)
    private readonly svc: ProactiveNotificationsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список моих проактивных уведомлений (от Коры)',
  })
  async list(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(ListProactiveQuerySchema))
    q: ListProactiveQuery,
  ): Promise<ListProactiveResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const rows = await this.svc.listMine({
      tenantId: tenantId!,
      userId: uid,
      includeDismissed: q.includeDismissed,
      limit: q.limit,
    });
    return { items: rows.map(this.toDto) };
  }

  @Post(':id/dismiss')
  @ApiOperation({ summary: 'Отметить проактивное уведомление как скрытое' })
  async dismiss(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<ProactiveNotificationDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    const row = await this.svc.dismiss({
      tenantId: tenantId!,
      userId: uid,
      id,
    });
    return this.toDto(row);
  }

  private toDto = (row: {
    id: string;
    ruleType: string;
    severity: string;
    payloadJson: unknown;
    notificationId: string | null;
    emittedAt: Date;
    dismissedAt: Date | null;
  }): ProactiveNotificationDto => ({
    id: row.id,
    ruleType: row.ruleType,
    severity:
      row.severity === 'low' || row.severity === 'medium' || row.severity === 'high'
        ? row.severity
        : 'low',
    payload: row.payloadJson,
    notificationId: row.notificationId,
    emittedAt: row.emittedAt.toISOString(),
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
  });

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }
}
