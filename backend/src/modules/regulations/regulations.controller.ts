import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
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
  RestoreRegulationBodySchema,
  type RestoreRegulationBody,
  SupersedeRegulationBodySchema,
  type SupersedeRegulationBody,
} from './dto/regulations.dto';
import { RegulationsService } from './services/regulations.service';

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
    summary: 'Список регламентов/процессов/политик Org (с фильтрами и пагинацией)',
  })
  async list(
    @Query(new ZodValidationPipe(ListRegulationsQuerySchema))
    q: ListRegulationsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListRegulationsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireReadAny(user.id, t);
    return this.svc.list({ tenantId: t, userId: user.id, query: q });
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Сводка хаба «Оцифровано»: счётчики 4 типов карточек + недельный прирост',
  })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RegulationSummaryResponse> {
    const t = this.requireTenant(tenantId);
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
    summary: 'Исправить запись (owner/admin — сразу; иначе — предложение в очередь курации)',
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

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить карточку (мягкое удаление, только owner/admin)',
  })
  async remove(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetRegulationParamsSchema))
    params: { kind: RegulationKindDto },
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t, params.kind);
    await this.svc.softDelete({
      tenantId: t,
      id,
      kind: params.kind,
      actorUserId: user.id,
    });
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Восстановить удалённую карточку (только owner/admin)',
  })
  async restore(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RestoreRegulationBodySchema))
    body: RestoreRegulationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t, body.kind);
    return this.svc.restore({
      tenantId: t,
      id,
      kind: body.kind,
      actorUserId: user.id,
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

  private async requireReadAny(userId: string, tenantId: string): Promise<void> {
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
