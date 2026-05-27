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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateCycleSchema,
  type CreateCycleDto,
} from '../dto/cycles/create-cycle.dto';
import type { SprintDashboardDto } from '../dto/cycles/cycle-dashboard.dto';
import type {
  CompleteCycleResult,
  CycleResponseDto,
  ListCyclesResponse,
} from '../dto/cycles/cycle-response.dto';
import {
  StartMeetingForCycleSchema,
  type StartMeetingForCycleDto,
  type StartMeetingForCycleResponseDto,
} from '../dto/cycles/start-meeting-for-cycle.dto';
import {
  UpdateCycleSchema,
  type UpdateCycleDto,
} from '../dto/cycles/update-cycle.dto';
import type { ListIssuesResponse } from '../dto/issues/issue-response.dto';
import type {
  ListSprintHintsResponseDto,
  SprintHintStatusDto,
} from '../dto/sprint-hints/sprint-hint.dto';
import { CycleMeetingsService } from '../services/cycle-meetings.service';
import { CyclesService } from '../services/cycles.service';
import { SprintAnalystService } from '../services/sprint-analyst.service';
import { SprintHintsService } from '../services/sprint-hints.service';

/**
 * REST `/api/v1/projects/:projectId/cycles` + `/cycles/:id` — циклы трекера.
 * RBAC ResourceType='cycle' (read: project_member; write/delete/complete: admin/owner).
 */
@ApiTags('tracker / cycles')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class CyclesController {
  constructor(
    @Inject(CyclesService) private readonly svc: CyclesService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(SprintAnalystService)
    private readonly analyst: SprintAnalystService,
    @Inject(SprintHintsService)
    private readonly hints: SprintHintsService,
    @Inject(CycleMeetingsService)
    private readonly cycleMeetings: CycleMeetingsService,
  ) {}

  @Get('projects/:projectId/cycles')
  @ApiOperation({ summary: 'Список циклов проекта' })
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListCyclesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(projectId, t);
  }

  @Post('projects/:projectId/cycles')
  @ApiOperation({ summary: 'Создать цикл в проекте' })
  async create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateCycleSchema)) body: CreateCycleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CycleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(projectId, body, t, user.id);
  }

  @Get('cycles/:id')
  @ApiOperation({ summary: 'Получить цикл по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CycleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findById(id, t);
  }

  @Patch('cycles/:id')
  @ApiOperation({ summary: 'Изменить цикл' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCycleSchema)) body: UpdateCycleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CycleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Post('cycles/:id/complete')
  @ApiOperation({ summary: 'Завершить цикл (auto-rollover незакрытых задач)' })
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CompleteCycleResult> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.complete(id, t, user.id);
  }

  @Get('cycles/:id/issues')
  @ApiOperation({ summary: 'Задачи цикла' })
  async issues(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIssuesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findIssues(id, t);
  }

  // ── Sprints (2026-05-27) — дашборд / встреча / подсказки ─────────────

  @Get('cycles/:id/dashboard')
  @ApiOperation({ summary: 'Дашборд спринта (агрегированные данные)' })
  async dashboard(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SprintDashboardDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    // Сначала проверим существование/tenant — выбросит 404 если нет.
    await this.svc.requireCycle(id, t);
    return this.analyst.getSprintDashboard({ cycleId: id, tenantId: t });
  }

  @Post('cycles/:id/start-meeting')
  @ApiOperation({
    summary: 'Запустить видеовстречу по спринту (default sprint_review)',
  })
  async startMeeting(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StartMeetingForCycleSchema))
    body: StartMeetingForCycleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<StartMeetingForCycleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.cycleMeetings.startMeeting({
      cycleId: id,
      tenantId: t,
      userId: user.id,
      type: body.type,
      title: body.title,
      inviteUserIds: body.inviteUserIds,
    });
  }

  @Get('cycles/:id/hints')
  @ApiOperation({ summary: 'Подсказки помощника по спринту' })
  async listHints(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListSprintHintsResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.svc.requireCycle(id, t);
    // Status можно прокинуть как ?status= через @Query — но MVP отдаёт все
    // active (фильтр-логика на фронте). При необходимости расширим.
    return this.hints.listByCycle({
      cycleId: id,
      tenantId: t,
      status: 'active' as SprintHintStatusDto,
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
    const ok = await this.rbac.canRead(userId, tenantId, 'cycle');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение циклов' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'cycle');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут управлять циклами',
        },
      });
    }
  }
}
