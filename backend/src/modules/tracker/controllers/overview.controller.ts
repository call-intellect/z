import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type { IntegrationsStatusResponseDto } from '../dto/overview/integrations-status-response.dto';
import type { OverviewResponseDto } from '../dto/overview/overview-response.dto';
import type { WorkloadResponseDto } from '../dto/overview/workload-response.dto';
import { IntegrationsStatusService } from '../services/integrations-status.service';
import { OverviewService } from '../services/overview.service';
import { WorkloadService } from '../services/workload.service';

@ApiTags('tracker / overview')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class OverviewController {
  constructor(
    @Inject(OverviewService) private readonly overview: OverviewService,
    @Inject(WorkloadService) private readonly workload: WorkloadService,
    @Inject(IntegrationsStatusService)
    private readonly integrations: IntegrationsStatusService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('projects/:projectId/overview')
  @ApiOperation({
    summary: 'Агрегат «Обзор проекта»: метрики, активный цикл, активность, цели, документы',
  })
  async getOverview(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OverviewResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.overview.getOverview({ projectId, tenantId: t });
  }

  @Get('projects/:projectId/workload')
  @ApiOperation({
    summary: 'Загруженность участников проекта (открыто/в работе/просрочено/завершено 7д)',
  })
  async getWorkload(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WorkloadResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.workload.getWorkload({ projectId, tenantId: t });
  }

  @Get('projects/:projectId/integrations-status')
  @ApiOperation({
    summary: 'Снимок состояния интеграций проекта (email-to-task, Telegram, webhooks, last import)',
  })
  async getIntegrationsStatus(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IntegrationsStatusResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.integrations.getStatus({
      projectId,
      tenantId: t,
      userId: user.id,
    });
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

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение проекта' },
      });
    }
  }
}
