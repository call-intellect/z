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
  ChangeStatusBodySchema,
  type ChangeStatusBody,
  CreateDecisionBodySchema,
  type CreateDecisionBody,
  type DecisionDetailDto,
  type DecisionHistoryResponse,
  type DecisionStatusDto,
  type DecisionSupersedeChainResponse,
  ListDecisionsQuerySchema,
  type ListDecisionsQuery,
  type ListDecisionsResponse,
  SetOutcomesBodySchema,
  type SetOutcomesBody,
  SupersedeDecisionBodySchema,
  type SupersedeDecisionBody,
} from './dto/decisions.dto';
import { DecisionsService } from './services/decisions.service';

/**
 * REST API реестра решений (SBA β-3).
 *
 *   GET  /api/v1/decisions                  — список с фильтрами / пагинацией.
 *   GET  /api/v1/decisions/:id              — детали Decision.
 *   GET  /api/v1/decisions/:id/history      — CardVersion timeline.
 *   GET  /api/v1/decisions/:id/supersede-chain — родители + потомки.
 *   POST /api/v1/decisions                  — manual create (owner/admin).
 *   POST /api/v1/decisions/:id/supersede    — заменить новой версией.
 *   POST /api/v1/decisions/:id/status       — изменить статус (+ CardVersion).
 *   POST /api/v1/decisions/:id/outcomes     — записать фактический результат.
 *
 * RBAC:
 *   - `decision` ResourceType.
 *   - Read: все member'ы Org (decision — shared knowledge).
 *   - Write: owner/admin (manual create, supersede, status, outcomes).
 *
 * Multi-tenancy: TenantGuard.
 * Все user-facing строки на русском.
 */
@ApiTags('decisions')
@Controller('api/v1/decisions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DecisionsController {
  constructor(
    @Inject(DecisionsService) private readonly svc: DecisionsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список решений Org (с фильтрами и пагинацией)',
  })
  async list(
    @Query(new ZodValidationPipe(ListDecisionsQuerySchema))
    q: ListDecisionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListDecisionsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, query: q });
  }

  @Post()
  @ApiOperation({
    summary: 'Создать решение вручную (только owner / admin)',
  })
  async create(
    @Body(new ZodValidationPipe(CreateDecisionBodySchema))
    body: CreateDecisionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createManual({
      tenantId: t,
      body,
      createdByUserId: user.id,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить решение по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, id });
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Timeline версий решения (CardVersion)' })
  async history(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionHistoryResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getHistory({ tenantId: t, id });
  }

  @Get(':id/supersede-chain')
  @ApiOperation({
    summary: 'Родительская и дочерние цепочки supersede для решения',
  })
  async supersedeChain(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DecisionSupersedeChainResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getSupersedeChain({ tenantId: t, id });
  }

  @Post(':id/supersede')
  @ApiOperation({
    summary: 'Заменить решение новой версией (только owner / admin)',
  })
  async supersede(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SupersedeDecisionBodySchema))
    body: SupersedeDecisionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.supersede({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
    });
  }

  @Post(':id/status')
  @ApiOperation({
    summary: 'Изменить статус решения (только owner / admin)',
  })
  async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeStatusBodySchema))
    body: ChangeStatusBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; status: DecisionStatusDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.changeStatus({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
    });
  }

  @Post(':id/outcomes')
  @ApiOperation({
    summary:
      'Записать фактический результат реализованного решения (owner / admin или автор)',
  })
  async setOutcomes(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetOutcomesBodySchema))
    body: SetOutcomesBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.setOutcomes({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
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
    const ok = await this.rbac.canRead(userId, tenantId, 'decision');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения решений',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'decision');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут изменять решения.',
        },
      });
    }
  }
}
