import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
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
  DecideCurationBodySchema,
  ListConflictsQuerySchema,
  ListCurationQueueQuerySchema,
  ResolveConflictBodySchema,
  UpdateCurationSettingsBodySchema,
  type DecideCurationBody,
  type ListConflictsQuery,
  type ListCurationQueueQuery,
  type ResolveConflictBody,
  type UpdateCurationSettingsBody,
} from './dto/curation.dto';
import { ConflictService } from './services/conflict.service';
import { CurationService } from './services/curation.service';

/**
 * REST API Слоя 4 (SBA α-4).
 *
 *   GET    /api/v1/curation/queue                     — очередь CurationItem
 *   GET    /api/v1/curation/items/:id                 — детальная CurationItem
 *   POST   /api/v1/curation/items/:id/decide          — принять решение
 *   GET    /api/v1/curation/conflicts                 — список ConflictItem
 *   GET    /api/v1/curation/conflicts/:id             — детальная ConflictItem
 *   POST   /api/v1/curation/conflicts/:id/resolve     — резолюция конфликта
 *   POST   /api/v1/curation/conflicts/:id/dismiss     — отказ от резолюции
 *   GET    /api/v1/settings/curation                  — настройки triage'а
 *   PATCH  /api/v1/settings/curation                  — обновить настройки
 *
 * RBAC: см. policy.csv §SBA α-4. Пользовательский доступ:
 *   - owner/admin: полный доступ;
 *   - manager: read self (только когда участвует кандидатом/назначен).
 *
 * Все эндпоинты — `CookieAuthGuard + TenantGuard`. Org берётся из заголовка
 * `X-Org-Id` или `:orgId` query.
 */
@ApiTags('curation')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CurationController {
  constructor(
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  // ──────────────────────────── curation queue ────────────────────────

  @Get('curation/queue')
  @ApiOperation({ summary: 'Очередь CurationItem (фильтры по level/status/resourceType, assignedToMe)' })
  async listQueue(
    @Query(new ZodValidationPipe(ListCurationQueueQuerySchema))
    query: ListCurationQueueQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, 'curation_item');
    return this.curation.listQueue({
      tenantId: t,
      requesterUserId: user.id,
      query,
    });
  }

  @Get('curation/items/:id')
  @ApiOperation({ summary: 'Получить CurationItem по id (с решениями и связанными конфликтами)' })
  async getItem(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, 'curation_item');
    return this.curation.getItemById({ tenantId: t, id });
  }

  @Post('curation/items/:id/decide')
  @ApiOperation({ summary: 'Принять решение по CurationItem' })
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecideCurationBodySchema))
    body: DecideCurationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    // Любой member Org может принять решение, если он в candidateCuratorIds
    // (проверка в сервисе). owner/admin — bypass.
    const allowed = await this.rbac.canWrite(user.id, t, 'curation_decision', user.id);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для принятия решения' },
      });
    }
    return this.curation.decide({
      tenantId: t,
      curationItemId: id,
      reviewerUserId: user.id,
      decisionType: body.decisionType,
      payload: body.payload,
      reasoning: body.reasoning,
    });
  }

  // ──────────────────────────── conflicts ────────────────────────────

  @Get('curation/conflicts')
  @ApiOperation({ summary: 'Список ConflictItem (фильтры по status/resourceType)' })
  async listConflicts(
    @Query(new ZodValidationPipe(ListConflictsQuerySchema))
    query: ListConflictsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, 'conflict_item');
    return this.conflicts.list({ tenantId: t, query });
  }

  @Get('curation/conflicts/:id')
  @ApiOperation({ summary: 'Получить ConflictItem по id' })
  async getConflict(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, 'conflict_item');
    return this.conflicts.getById({ tenantId: t, id });
  }

  @Post('curation/conflicts/:id/resolve')
  @ApiOperation({ summary: 'Резолюция конфликта (accept_new | keep_old | merge | evolving)' })
  async resolveConflict(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveConflictBodySchema))
    body: ResolveConflictBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    const allowed = await this.rbac.canWrite(user.id, t, 'conflict_item');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для резолюции конфликта' },
      });
    }
    return this.conflicts.resolve({
      tenantId: t,
      conflictId: id,
      reviewerUserId: user.id,
      resolution: body.resolution,
      evolvingMeta: body.evolvingMeta,
      reasoning: body.reasoning,
    });
  }

  @Post('curation/conflicts/:id/dismiss')
  @ApiOperation({ summary: 'Отказ от резолюции конфликта (status=dismissed)' })
  async dismissConflict(
    @Param('id') id: string,
    @Body() body: { reasoning?: string },
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    const allowed = await this.rbac.canWrite(user.id, t, 'conflict_item');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    return this.conflicts.dismiss({
      tenantId: t,
      conflictId: id,
      reviewerUserId: user.id,
      reasoning: body?.reasoning,
    });
  }

  // ──────────────────────────── settings ─────────────────────────────

  @Get('settings/curation')
  @ApiOperation({ summary: 'Получить настройки Слоя 4 (пороги, critical-types)' })
  async getSettings(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t, 'curator_assignment');
    return this.curation.getSettings(t);
  }

  @Patch('settings/curation')
  @ApiOperation({ summary: 'Обновить настройки Слоя 4 (only owner/admin)' })
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateCurationSettingsBodySchema))
    body: UpdateCurationSettingsBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    const allowed = await this.rbac.canWrite(user.id, t, 'curator_assignment');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner/admin Org может менять настройки проверки',
        },
      });
    }
    return this.curation.updateSettings({ tenantId: t, patch: body });
  }

  // ──────────────────────────── helpers ─────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(
    userId: string,
    tenantId: string,
    obj:
      | 'curation_item'
      | 'curation_decision'
      | 'conflict_item'
      | 'card_version'
      | 'curator_assignment',
  ): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, obj, userId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав',
        },
      });
    }
  }
}
