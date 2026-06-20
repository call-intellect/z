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
  Optional,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';
import { Specialist314GoalsService } from '../knowledge-core/services/specialist-3-14-goals.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  AddThemesSchema,
  CreateGoalSchema,
  CreateKeyResultSchema,
  ListGoalsQuerySchema,
  SetGoalPrioritySchema,
  SupersedeGoalSchema,
  type SuggestParentResponse,
  UpdateGoalSchema,
  UpdateKeyResultSchema,
  type AddThemesDto,
  type CreateGoalDto,
  type CreateKeyResultDto,
  type GoalDetailDto,
  type GoalIssueProgressSnapshotDto,
  type GoalKeyResultDto,
  type GoalListItemDto,
  type ListGoalsQuery,
  type SetGoalPriorityDto,
  type SupersedeGoalDto,
  type UpdateGoalDto,
  type UpdateKeyResultDto,
} from './dto/goals.dto';
import { GoalKeyResultsService } from './services/goal-key-results.service';
import { GoalsService } from './services/goals.service';

@ApiTags('goals')
@Controller('api/v1/goals')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.goals_strategy')
export class GoalsController {
  constructor(
    @Inject(GoalsService) private readonly goals: GoalsService,
    @Inject(GoalKeyResultsService)
    private readonly keyResults: GoalKeyResultsService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Optional()
    @Inject(Specialist314GoalsService)
    private readonly specialist314: Specialist314GoalsService | null = null,
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
  @RequireSubscription()
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
  @RequireSubscription()
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

  @Patch(':id/priority')
  @RequireSubscription()
  @ApiOperation({
    summary: 'ТЗ-2 Ф6.A — проставить MoSCoW-приоритет цели (must/should/could/wont или null)',
  })
  async setPriority(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetGoalPrioritySchema)) body: SetGoalPriorityDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; priority: 'must' | 'should' | 'could' | 'wont' | null }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.setPriority({
      tenantId: t,
      userId: user.id,
      goalId: id,
      priority: body.priority,
    });
  }

  @Post(':id/suggest-parent')
  @ApiOperation({
    summary:
      'ТЗ карты целей — Кора предлагает родителя для orphan-цели (read-only, KNN + арбитр)',
  })
  async suggestParent(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SuggestParentResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    if (!this.specialist314) {
      return {
        suggestedParentGoalId: null,
        verdict: 'standalone',
        candidates: [],
        reasoning: 'Подсказка временно недоступна.',
        confidence: null,
      };
    }
    return this.specialist314.suggestParentForGoal({ tenantId: t, goalId: id });
  }

  @Delete(':id')
  @RequireSubscription()
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

  @Post(':id/supersede')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Заменить цель новой версией («передумали»); старая уходит в историю (validUntil)',
  })
  async supersede(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SupersedeGoalSchema)) body: SupersedeGoalDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.goals.supersede({
      tenantId: t,
      userId: user.id,
      goalId: id,
      body,
    });
  }

  @Post(':id/key-results')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать ключевой результат (KR) цели' })
  async createKeyResult(
    @Param('id') goalId: string,
    @Body(new ZodValidationPipe(CreateKeyResultSchema)) body: CreateKeyResultDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalKeyResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireKrWrite(user.id, t);
    return this.keyResults.create({
      tenantId: t,
      userId: user.id,
      goalId,
      body,
    });
  }

  @Patch(':id/key-results/:krId')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Обновить KR (ручной ввод currentValue пишет checkpoint; правленые поля → manualOverride)',
  })
  async updateKeyResult(
    @Param('id') goalId: string,
    @Param('krId') krId: string,
    @Body(new ZodValidationPipe(UpdateKeyResultSchema)) body: UpdateKeyResultDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalKeyResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireKrWrite(user.id, t);
    return this.keyResults.update({
      tenantId: t,
      userId: user.id,
      goalId,
      krId,
      body,
    });
  }

  @Delete(':id/key-results/:krId')
  @RequireSubscription()
  @ApiOperation({ summary: 'Удалить KR (hard delete, cascade снимет checkpoints)' })
  async removeKeyResult(
    @Param('id') goalId: string,
    @Param('krId') krId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ removed: boolean }> {
    const t = this.requireTenant(tenantId);
    await this.requireKrDelete(user.id, t);
    return this.keyResults.remove({
      tenantId: t,
      userId: user.id,
      goalId,
      krId,
    });
  }

  @Post(':id/themes')
  @RequireSubscription()
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
  @RequireSubscription()
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

  @Get(':id/alignment-snapshot')
  @ApiOperation({
    summary:
      'Sprint 3 B1-3.2 — issue-based snapshot (totalLinked/completed/blocked/timeProgress/alignmentScore)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Snapshot из Redis-кэша (fromCache=true) или посчитанный on-the-fly (fromCache=false).',
  })
  @ApiResponse({ status: 404, description: 'Цель не найдена в Org.' })
  async issueAlignmentSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GoalIssueProgressSnapshotDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.goals.getIssueAlignmentSnapshot({ tenantId: t, goalId: id });
  }

  @Post(':id/recompute')
  @RequireSubscription()
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

  private async requireKrWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'goal_key_result');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Ключевые результаты изменяет только владелец Org',
        },
      });
    }
  }

  private async requireKrDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'goal_key_result',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Удаляет ключевые результаты только владелец Org',
        },
      });
    }
  }
}
