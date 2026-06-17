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
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { CreateIssueSchema, type CreateIssueDto } from '../dto/issues/create-issue.dto';
import type {
  IssueActivityDto,
  IssueChildrenResponseDto,
  IssueResponseDto,
  IssueVersionDto,
  ListIssuesResponse,
} from '../dto/issues/issue-response.dto';
import {
  AddAssigneeSchema,
  type AddAssigneeDto,
  AddLabelSchema,
  type AddLabelDto,
  LinkGoalSchema,
  type LinkGoalDto,
  ListIssuesQuerySchema,
  type ListIssuesQuery,
} from '../dto/issues/list-issues-query.dto';
import type { SimilarIssueDto } from '../dto/issues/similar-issue.dto';
import {
  StartMeetingFromIssueSchema,
  type StartMeetingFromIssueDto,
  type StartMeetingFromIssueResponseDto,
} from '../dto/issues/start-meeting.dto';
import { MoveIssueSchema, type MoveIssueDto } from '../dto/issues/move-issue.dto';
import {
  TransitionIssueStateSchema,
  type TransitionIssueStateDto,
} from '../dto/issues/transition-state.dto';
import { UpdateIssueSchema, type UpdateIssueDto } from '../dto/issues/update-issue.dto';
import { IssueMeetingsService } from '../services/issue-meetings.service';
import { IssuesService } from '../services/issues.service';
import { SimilarIssuesService } from '../services/similar-issues.service';

@ApiTags('tracker / issues')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IssuesController {
  constructor(
    @Inject(IssuesService) private readonly svc: IssuesService,
    @Inject(IssueMeetingsService)
    private readonly issueMeetings: IssueMeetingsService,
    @Inject(SimilarIssuesService)
    private readonly similar: SimilarIssuesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('projects/:projectId/issues')
  @ApiOperation({ summary: 'Список задач проекта' })
  async list(
    @Param('projectId') projectId: string,
    @Query(new ZodValidationPipe(ListIssuesQuerySchema)) query: ListIssuesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIssuesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(projectId, t, query);
  }

  @Post('projects/:projectId/issues')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать задачу в проекте' })
  async create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateIssueSchema)) body: CreateIssueDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(projectId, body, t, user.id);
  }

  @Get('issues/:id')
  @ApiOperation({ summary: 'Получить задачу по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findById(id, t);
  }

  @Get('issues/:id/children')
  @ApiOperation({
    summary:
      'Список прямых детей задачи (подзадачи). ' +
      'Сортировка: sortOrder ASC, createdAt ASC. ' +
      'Используется фронтом для блока «Подзадачи» в карточке родителя.',
  })
  async children(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueChildrenResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findChildren(id, t);
  }

  @Get('issues/by-identifier/:identifier')
  @ApiOperation({ summary: 'Получить задачу по identifier (например KORA-123)' })
  async byIdentifier(
    @Param('identifier') identifier: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findByIdentifier(identifier, t);
  }

  @Patch('issues/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить задачу' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIssueSchema)) body: UpdateIssueDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Delete('issues/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить задачу (soft delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    await this.svc.softDelete(id, t, user.id);
  }

  @Post('issues/:id/transitions')
  @RequireSubscription()
  @ApiOperation({ summary: 'Сменить статус задачи (status_changed)' })
  async transition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransitionIssueStateSchema))
    body: TransitionIssueStateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.transitionState(id, body, t, user.id);
  }

  @Post('issues/:id/move')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Перенести задачу в другой проект (moved_to_project). ' +
      'Атомарно переназначает identifier/sequenceId, ремапит статус по ' +
      'категории и доску на дефолтную целевого проекта, сбрасывает спринт.',
  })
  async move(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveIssueSchema)) body: MoveIssueDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.moveToProject(id, body.targetProjectId, t, user.id);
  }

  @Post('issues/:id/assignees')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить исполнителя' })
  async addAssignee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddAssigneeSchema)) body: AddAssigneeDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.addAssignee(id, body.userId, t, user.id);
  }

  @Delete('issues/:id/assignees/:userId')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить исполнителя' })
  async removeAssignee(
    @Param('id') id: string,
    @Param('userId') assigneeUserId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.removeAssignee(id, assigneeUserId, t, user.id);
  }

  @Post('issues/:id/labels')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить метку' })
  async addLabel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddLabelSchema)) body: AddLabelDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.addLabel(id, body.labelId, t, user.id);
  }

  @Delete('issues/:id/labels/:labelId')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить метку' })
  async removeLabel(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.removeLabel(id, labelId, t, user.id);
  }

  @Post('issues/:id/subscribe')
  @RequireSubscription()
  @ApiOperation({ summary: 'Подписаться на задачу' })
  async subscribe(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.subscribe(id, user.id, t);
  }

  @Delete('issues/:id/subscribe')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Отписаться от задачи' })
  async unsubscribe(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.svc.unsubscribe(id, user.id, t);
  }

  @Post('issues/:id/link-goal')
  @RequireSubscription()
  @ApiOperation({ summary: 'Связать задачу с целью' })
  async linkGoal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(LinkGoalSchema)) body: LinkGoalDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.linkGoal(id, body.goalId, t, user.id);
  }

  @Delete('issues/:id/link-goal')
  @RequireSubscription()
  @ApiOperation({ summary: 'Отвязать задачу от цели' })
  async unlinkGoal(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.unlinkGoal(id, t, user.id);
  }

  @Post('issues/:id/start-meeting')
  @RequireSubscription()
  @ApiOperation({
    summary:
      'Запустить LiveKit-встречу по задаче (type=task_discussion). ' +
      'Создаёт Meeting + host-Participant + IssueActivity. Возвращает host JWT.',
  })
  async startMeeting(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StartMeetingFromIssueSchema))
    body: StartMeetingFromIssueDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<StartMeetingFromIssueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.issueMeetings.startMeeting({
      issueId: id,
      tenantId: t,
      userId: user.id,
      inviteUserIds: body.inviteUserIds,
    });
  }

  @Get('issues/:id/activity')
  @ApiOperation({ summary: 'Лента активности задачи' })
  async activity(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueActivityDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getActivity(id, t);
  }

  @Get('issues/:id/versions')
  @ApiOperation({ summary: 'Исторические снимки задачи' })
  async versions(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueVersionDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getVersions(id, t);
  }

  @Get('tracker/issues/:id/similar')
  @ApiOperation({
    summary:
      'Похожие задачи (KNN cosine по pgvector embedding). ' +
      'Используется правой панелью карточки задачи для подсказки ' +
      '«похожие проблемы» / «уже решено». RBAC: issue.read.',
  })
  async similarIssues(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SimilarIssueDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    await this.svc.requireIssue(id, t);
    return this.similar.findSimilar({ tenantId: t, issueId: id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на изменение задач' },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'issue',
      act: 'delete',
      resourceOwnerId: userId,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на удаление задач' },
      });
    }
  }
}
