import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { StructureService, type StructureSummaryDto } from './structure.service';

@ApiTags('structure')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class StructureController {
  constructor(
    @Inject(StructureService) private readonly svc: StructureService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('structure/summary')
  @ApiOperation({ summary: 'Сводные счётчики структуры компании' })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<StructureSummaryDto> {
    const t = this.requireTenant(tenantId);
    const ok = await this.rbac.canRead(user.id, t, 'department');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    return this.svc.summary(t);
  }

  @Get('processes/count')
  @ApiOperation({ summary: 'Количество процессов в Org (для γ preview)' })
  async processCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ count: number }> {
    const t = this.requireTenant(tenantId);
    await this.requirePrivileged(user.id, t, 'process');
    return { count: await this.svc.processCount(t) };
  }

  @Get('regulations/count')
  @ApiOperation({ summary: 'Количество регламентов в Org (для γ preview)' })
  async regulationCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ count: number }> {
    const t = this.requireTenant(tenantId);
    await this.requirePrivileged(user.id, t, 'regulation');
    return { count: await this.svc.regulationCount(t) };
  }

  @Get('policies/count')
  @ApiOperation({ summary: 'Количество политик в Org (для γ preview)' })
  async policyCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ count: number }> {
    const t = this.requireTenant(tenantId);
    await this.requirePrivileged(user.id, t, 'policy');
    return { count: await this.svc.policyCount(t) };
  }

  @Get('metrics/count')
  @ApiOperation({ summary: 'Количество метрик в Org (для γ preview)' })
  async metricCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ count: number }> {
    const t = this.requireTenant(tenantId);
    await this.requirePrivileged(user.id, t, 'metric');
    return { count: await this.svc.metricCount(t) };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requirePrivileged(
    userId: string,
    tenantId: string,
    obj: 'process' | 'regulation' | 'policy' | 'metric',
  ): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, obj);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Доступ к γ-счётчикам — только для владельца/администратора Org',
        },
      });
    }
  }
}
