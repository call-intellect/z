import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type { MyInboxCountDto, MyInboxResponseDto } from '../dto/issues/issue-response.dto';
import {
  MyMethodCapturePendingQuerySchema,
  MyTaskBucketsQuerySchema,
  type MethodCapturePendingResponseDto,
  type MyMethodCapturePendingQuery,
  type MyTaskBucketsQuery,
  type TaskBucketsResponseDto,
} from '../dto/issues/me-task-buckets.dto';
import { MyInboxQuerySchema, type MyInboxQuery } from '../dto/issues/my-inbox-query.dto';
import { IssuesService } from '../services/issues.service';

@ApiTags('tracker / me')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeInboxController {
  constructor(
    @Inject(IssuesService) private readonly svc: IssuesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('me/inbox')
  @ApiOperation({
    summary: 'Мои задачи (assignee = текущий пользователь) во всех проектах',
    description:
      'Возвращает плоский список Issue, отфильтрованный по IssueAssignee.userId = currentUser. ' +
      'Cursor-based пагинация: для следующей страницы передавай ?cursor={nextCursor}. ' +
      'nextCursor=null означает, что страница последняя.',
  })
  @ApiResponse({
    status: 200,
    description: 'Список задач + nextCursor для следующей страницы',
  })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение задач' })
  async inbox(
    @Query(new ZodValidationPipe(MyInboxQuerySchema)) query: MyInboxQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyInboxResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findMyInbox(t, user.id, query);
  }

  @Get('me/inbox/count')
  @ApiOperation({
    summary: 'Счётчик задач в моём инбоксе (total + unread)',
    description:
      'Возвращает { total, unread } — число задач, в которых currentUser ' +
      'является assignee (без архивных/удалённых). На данной версии модели ' +
      'IssueRead нет, поэтому unread = total. Контракт фиксированный — ' +
      'когда IssueRead появится, цифры разойдутся без изменения формата.',
  })
  @ApiResponse({
    status: 200,
    description: 'Структура { total: number, unread: number }',
  })
  @ApiResponse({ status: 400, description: 'tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение задач' })
  async inboxCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MyInboxCountDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.countMyInbox(t, user.id);
  }

  @Get('me/tasks/buckets')
  @ApiOperation({
    summary: 'Мои задачи по букетам: зависли/просрочено · в работе · без срока · сделано',
    description:
      'Борд задач стенда сотрудника. Букеты вычисляются машинно: overdueStuck = dueDate<now ИЛИ нет активности >staleDays; inProgress = state.category=started; noDueDate = dueDate=null; done = completedAt за окно me.tasks.doneWindowDays. Backlog с будущей датой в букеты не входит.',
  })
  @ApiResponse({ status: 200, description: '4 букета + counts' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение задач' })
  async taskBuckets(
    @Query(new ZodValidationPipe(MyTaskBucketsQuerySchema)) query: MyTaskBucketsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TaskBucketsResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findMyTaskBuckets(t, user.id, query, new Date());
  }

  @Get('me/tasks/method-capture-pending')
  @ApiOperation({
    summary: 'Закрытые задачи, по которым ещё не записан метод («расскажи как делал»)',
    description:
      'Кандидаты для значка «🎤 расскажи как делал» на борде: completedAt задан, methodCapturedAt пуст, assignee = self, сложность ≥ tracker.methodCaptureMinComplexity (та же формула, что у probe при закрытии).',
  })
  @ApiResponse({ status: 200, description: 'Список кандидатов + сложность' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение задач' })
  async methodCapturePending(
    @Query(new ZodValidationPipe(MyMethodCapturePendingQuerySchema)) query: MyMethodCapturePendingQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MethodCapturePendingResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findMyMethodCapturePending(t, user.id, query.limit, new Date());
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
}
