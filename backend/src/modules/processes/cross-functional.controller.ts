import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
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

import {
  type CrossFunctionalFrictionReportDto,
  ListCrossFunctionalFrictionQuerySchema,
  type ListCrossFunctionalFrictionQuery,
  type ListCrossFunctionalFrictionResponse,
  ListCrossFunctionalProcessesQuerySchema,
  type ListCrossFunctionalProcessesQuery,
  type ListCrossFunctionalProcessesResponse,
  ResolveCrossFunctionalFrictionBodySchema,
  type ResolveCrossFunctionalFrictionBody,
} from './dto/cross-functional.dto';
import { CrossFunctionalFrictionService } from './services/cross-functional-friction.service';

/**
 * SBA γ-3 — REST API CrossFunctional.
 *
 *   GET    /api/v1/processes/cross-functional             — список cross-functional ProcessTemplate
 *   GET    /api/v1/processes/cross-functional/:id/friction
 *                                                          — friction-отчёты по шаблону
 *   POST   /api/v1/processes/cross-functional/friction/:id/resolve
 *                                                          — закрыть отчёт
 *
 * RBAC ResourceType:
 *   - `process_template_cross_functional` — read (employee, coo, admin / owner);
 *     resolve — только admin/owner (action='write').
 *
 * Используется существующий `process_template`-ресурс RBAC: cross-functional
 * — лишь подвид того же ресурса (см. §10 sub-ТЗ). Action 'write' для resolve.
 */
@ApiTags('processes')
@Controller('api/v1/processes/cross-functional')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CrossFunctionalController {
  constructor(
    @Inject(CrossFunctionalFrictionService)
    private readonly friction: CrossFunctionalFrictionService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список cross-functional ProcessTemplate (isCrossFunctional=true) с активным friction-counter',
  })
  async list(
    @Query(new ZodValidationPipe(ListCrossFunctionalProcessesQuerySchema))
    q: ListCrossFunctionalProcessesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListCrossFunctionalProcessesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.friction.listCrossFunctionalProcesses({
      tenantId: t,
      query: q,
    });
  }

  @Get(':id/friction')
  @ApiOperation({
    summary: 'Список friction-отчётов по cross-functional ProcessTemplate',
  })
  async listFriction(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListCrossFunctionalFrictionQuerySchema))
    q: ListCrossFunctionalFrictionQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListCrossFunctionalFrictionResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.friction.listFrictionReports({
      tenantId: t,
      processTemplateId: id,
      includeResolved: q.includeResolved,
    });
  }

  @Post('friction/:id/resolve')
  @ApiOperation({
    summary:
      'Закрыть friction-отчёт (resolvedByUserId = CurrentUser, resolvedAt = now)',
  })
  async resolveFriction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveCrossFunctionalFrictionBodySchema))
    _body: ResolveCrossFunctionalFrictionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CrossFunctionalFrictionReportDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.friction.resolveReport({
      tenantId: t,
      reportId: id,
      resolvedByUserId: user.id,
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'process_template');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Недостаточно прав для просмотра сквозных процессов компании',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'process_template',
      act: 'write',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message:
            'Только admin/owner могут закрывать отчёты cross-functional friction',
        },
      });
    }
  }
}
