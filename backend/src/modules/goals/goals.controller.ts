import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  AddThemesSchema,
  CreateGoalSchema,
  ListGoalsQuerySchema,
  UpdateGoalSchema,
  type AddThemesDto,
  type CreateGoalDto,
  type GoalDetailDto,
  type GoalListItemDto,
  type ListGoalsQuery,
  type UpdateGoalDto,
} from './dto/goals.dto';
import { GoalsService } from './services/goals.service';

/**
 * REST API целей компании (Фаза 9 knowledge-core):
 *   - GET    /api/v1/goals?status=&limit=        — список (read).
 *   - GET    /api/v1/goals/:id                   — деталка + timeline (read).
 *   - POST   /api/v1/goals                       — создать (write — owner only).
 *   - PATCH  /api/v1/goals/:id                   — обновить (write).
 *   - DELETE /api/v1/goals/:id                   — soft-archive (delete).
 *   - POST   /api/v1/goals/:id/themes            — привязать темы (write).
 *   - DELETE /api/v1/goals/:id/themes/:themeId   — отвязать тему (write).
 *
 * RBAC ресурс — `goal`. policy.csv:
 *   - owner — read/write/delete.
 *   - admin/manager — read.
 *   - super_admin — bypass.
 *
 * Endpoint `POST /:id/recompute` добавляется на Шаге 5.
 */
@ApiTags('goals')
@Controller('api/v1/goals')
@UseGuards(CookieAuthGuard, TenantGuard)
export class GoalsController {
  constructor(
    @Inject(GoalsService) private readonly goals: GoalsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список целей Org (фильтр status, лимит)' })
  async list(
    @Query(new ZodValidationPipe(ListGoalsQuerySchema)) q: ListGoalsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: GoalListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.goals.list({ tenantId: t, status: q.status, limit: q.limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Цель + связанные темы + последний snapshot + timeline' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.goals.get({ tenantId: t, goalId: id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать цель (owner only)' })
  async create(
    @Body(new ZodValidationPipe(CreateGoalSchema)) body: CreateGoalDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalListItemDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.create({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить цель (owner only)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateGoalSchema)) body: UpdateGoalDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalListItemDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.update({
      tenantId: t,
      userId: user.id,
      goalId: id,
      body,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Архивировать цель (soft-delete) — owner only' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; archivedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.goals.archive({ tenantId: t, userId: user.id, goalId: id });
  }

  @Post(':id/themes')
  @ApiOperation({ summary: 'Привязать темы к цели (owner only)' })
  async addThemes(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddThemesSchema)) body: AddThemesDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ added: number; skipped: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.addThemes({
      tenantId: t,
      userId: user.id,
      goalId: id,
      themeIds: body.themeIds,
    });
  }

  @Delete(':id/themes/:themeId')
  @ApiOperation({ summary: 'Отвязать тему от цели (owner only)' })
  async removeTheme(
    @Param('id') id: string,
    @Param('themeId') themeId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ removed: boolean }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.removeTheme({
      tenantId: t,
      userId: user.id,
      goalId: id,
      themeId,
    });
  }

  @Post(':id/recompute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ручной пересчёт strategic-alignment (owner/super_admin)' })
  async recompute(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ enqueued: true; jobId: string }> {
    const t = this.requireTenant(tenantId);
    const allowed = await this.rbac.canManageOrg(user.id, t);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Пересчёт доступен только владельцу Org',
        },
      });
    }
    return this.goals.recompute({
      tenantId: t,
      userId: user.id,
      goalId: id,
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'goal');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав для чтения целей' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'goal');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Цели изменяет только владелец Org' },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'goal',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Архивирует цели только владелец Org' },
      });
    }
  }
}
