import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SelfPersonResolverService } from '../operations/services/self-person-resolver.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import type { LoadByPersonRow, StuckIssueRow } from './dto/execution-dashboard.dto';
import { ExecutionDashboardService } from './services/execution-dashboard.service';
import { PersonExpertiseService, type MyExpertiseDto } from './services/person-expertise.service';

@ApiTags('me-execution')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyExecutionDashboardController {
  constructor(
    @Inject(ExecutionDashboardService)
    private readonly exec: ExecutionDashboardService,
    @Inject(PersonExpertiseService)
    private readonly expertise: PersonExpertiseService,
    @Inject(SelfPersonResolverService)
    private readonly selfPerson: SelfPersonResolverService,
  ) {}

  @Get('load')
  @ApiOperation({ summary: 'Моя нагрузка (self-срез getLoadByPerson)' })
  async load(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<{ row: LoadByPersonRow | null }> {
    const uid = this.requireUser(req);
    const t = this.requireTenant(tenantId);
    const { rows } = await this.exec.getLoadByPerson({ tenantId: t });
    return { row: rows.find((r) => r.userId === uid) ?? null };
  }

  @Get('stuck')
  @ApiOperation({ summary: 'Мои зависшие задачи (self-фильтр getStuckCrossProject)' })
  async stuck(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<{ items: StuckIssueRow[]; staleDaysThreshold: number }> {
    const uid = this.requireUser(req);
    const t = this.requireTenant(tenantId);
    const { items, staleDaysThreshold } = await this.exec.getStuckCrossProject({
      tenantId: t,
      now: new Date(),
    });
    return { items: items.filter((i) => i.assigneeUserId === uid), staleDaysThreshold };
  }

  @Get('expertise')
  @ApiOperation({ summary: 'Мой профиль экспертизы — топ тем/сущностей, по которым я носитель знания' })
  async myExpertise(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<MyExpertiseDto> {
    const uid = this.requireUser(req);
    const t = this.requireTenant(tenantId);
    const personId = await this.resolveSelfPersonId(t, uid);
    if (!personId) return { blocksScanned: 0, themes: [], entities: [] };
    return this.expertise.getMyExpertise({ tenantId: t, personId });
  }

  private async resolveSelfPersonId(tenantId: string, userId: string): Promise<string | null> {
    try {
      const person = await this.selfPerson.resolveSelfPerson({ tenantId, userId });
      return person.id;
    } catch (err) {
      if (
        err instanceof ForbiddenException &&
        (err.getResponse() as { error?: { code?: string } })?.error?.code === 'no_person'
      ) {
        return null;
      }
      throw err;
    }
  }

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

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }
}
