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
import { RbacService, type ResourceType } from '../rbac/rbac.service';

import {
  ConfirmRegulationBodySchema,
  type ConfirmRegulationBody,
  CorrectRegulationBodySchema,
  type CorrectRegulationBody,
  DisputeRegulationBodySchema,
  type DisputeRegulationBody,
  GetRegulationParamsSchema,
  ListRegulationsQuerySchema,
  type ListRegulationsQuery,
  type ListRegulationsResponse,
  type RegulationDetailDto,
  type RegulationHistoryResponse,
  type RegulationKindDto,
  type RegulationSourcesResponse,
  type RegulationSummaryResponse,
  SupersedeRegulationBodySchema,
  type SupersedeRegulationBody,
} from './dto/regulations.dto';
import { RegulationsService } from './services/regulations.service';

/**
 * REST API регламентов / процессов / политик (SBA α-7).
 *
 *   GET  /api/v1/regulations?kind=&status=&scope=&q=&page=&limit=
 *   GET  /api/v1/regulations/:id?kind=
 *   GET  /api/v1/regulations/:id/history?kind=
 *   POST /api/v1/regulations/:id/supersede   { kind, supersededByRegulationId }
 *   POST /api/v1/regulations/:id/confirm     { kind }
 *
 * RBAC:
 *   - `regulation` / `process` / `process-step` / `policy` ResourceType.
 *   - Read: все member'ы Org (через policy.csv).
 *   - Supersede/confirm: owner/admin (write на соответствующий ResourceType).
 *
 * Multi-tenancy: TenantGuard достаёт `tenantId` из `X-Org-Id` / `:orgId`.
 * Все запросы скоупятся на `tenantId`.
 */
@ApiTags('regulations')
@Controller('api/v1/regulations')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RegulationsController {
  constructor(
    @Inject(RegulationsService) private readonly svc: RegulationsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список регламентов/процессов/политик Org (с фильтрами и пагинацией)',
  })
  async list(
    @Query(new ZodValidationPipe(ListRegulationsQuerySchema))
    q: ListRegulationsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListRegulationsResponse> {
    const t = this.requireTenant(tenantId);
    // Чтение разрешено любому, у кого есть read на хотя бы одну категорию.
    // Проще всего проверить regulation/process/policy и считать, что
    // если есть read на любую — пускаем (фильтр kind у нас единый).
    await this.requireReadAny(user.id, t);
    return this.svc.list({ tenantId: t, userId: user.id, query: q });
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Сводка хаба «Оцифровано»: счётчики 4 типов карточек + недельный прирост',
  })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RegulationSummaryResponse> {
    const t = this.requireTenant(tenantId);
    // Доступ как у list — read на любой из 4 типов (чтобы read-доступ к хабу
    // давал и сводку; manager не должен упираться в requirePrivileged).
    await this.requireReadAny(user.id, t);
    return this.svc.getSummary(t);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить регламент / процесс / политику по id и kind' })
  async byId(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetRegulationParamsSchema))
    params: { kind: RegulationKindDto },
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RegulationDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, params.kind);
    return this.svc.getByIdAndKind({ tenantId: t, id, kind: params.kind });
  }

  @Get(':id/sources')
  @ApiOperation({
    summary: 'Цитаты-первоисточники карточки (провенанс хаба «Оцифровано»)',
  })
  async sources(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetRegulationParamsSchema))
    params: { kind: RegulationKindDto },
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RegulationSourcesResponse> {
    const t = this.requireTenant(tenantId);
    // Тот же гейт, что у GET /:id — read на конкретный kind карточки.
    await this.requireRead(user.id, t, params.kind);
    return this.svc.getSources({ tenantId: t, id, kind: params.kind });
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Timeline версий карточки (CardVersion)' })
  async history(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetRegulationParamsSchema))
    params: { kind: RegulationKindDto },
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RegulationHistoryResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, params.kind);
    return this.svc.getHistory({ tenantId: t, id, kind: params.kind });
  }

  @Post(':id/supersede')
  @ApiOperation({
    summary: 'Заменить регламент новой версией (только owner/admin)',
  })
  async supersede(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SupersedeRegulationBodySchema))
    body: SupersedeRegulationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t, body.kind);
    return this.svc.supersede({ tenantId: t, id, body });
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Подтвердить актуальность (отметить lastConfirmedAt = now)',
  })
  async confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConfirmRegulationBodySchema))
    body: ConfirmRegulationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; lastConfirmedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t, body.kind);
    return this.svc.confirm({ tenantId: t, id, body });
  }

  @Post(':id/dispute')
  @ApiOperation({
    summary: 'Оспорить запись («это неверно») — обучающий сигнал',
  })
  async dispute(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DisputeRegulationBodySchema))
    body: DisputeRegulationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, body.kind);
    return this.svc.dispute({
      tenantId: t,
      id,
      kind: body.kind,
      reason: body.reason,
      actorUserId: user.id,
    });
  }

  @Post(':id/correct')
  @ApiOperation({
    summary:
      'Исправить запись (owner/admin — сразу; иначе — предложение в очередь курации)',
  })
  async correct(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CorrectRegulationBodySchema))
    body: CorrectRegulationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; applied: boolean }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, body.kind);
    const canApplyDirectly = await this.rbac.check({
      userId: user.id,
      tenantId: t,
      obj: this.mapKindToResourceType(body.kind),
      act: 'write',
    });
    return this.svc.correct({
      tenantId: t,
      id,
      kind: body.kind,
      correctedPayload: body.correctedPayload,
      reason: body.reason,
      actorUserId: user.id,
      canApplyDirectly,
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

  private mapKindToResourceType(kind: RegulationKindDto): ResourceType {
    if (kind === 'process') return 'process';
    if (kind === 'policy') return 'policy';
    if (kind === 'instruction') return 'instruction';
    return 'regulation';
  }

  private async requireRead(
    userId: string,
    tenantId: string,
    kind: RegulationKindDto,
  ): Promise<void> {
    const obj = this.mapKindToResourceType(kind);
    const ok = await this.rbac.canRead(userId, tenantId, obj);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения этой записи',
        },
      });
    }
  }

  private async requireReadAny(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const checks = await Promise.all([
      this.rbac.canRead(userId, tenantId, 'regulation'),
      this.rbac.canRead(userId, tenantId, 'process'),
      this.rbac.canRead(userId, tenantId, 'policy'),
      this.rbac.canRead(userId, tenantId, 'instruction'),
    ]);
    if (!checks.some(Boolean)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения регламентов',
        },
      });
    }
  }

  private async requireWrite(
    userId: string,
    tenantId: string,
    kind: RegulationKindDto,
  ): Promise<void> {
    const obj = this.mapKindToResourceType(kind);
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj,
      act: 'write',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут изменять регламенты',
        },
      });
    }
  }
}
