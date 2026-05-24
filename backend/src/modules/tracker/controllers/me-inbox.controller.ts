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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type {
  MyInboxCountDto,
  MyInboxResponseDto,
} from '../dto/issues/issue-response.dto';
import {
  MyInboxQuerySchema,
  type MyInboxQuery,
} from '../dto/issues/my-inbox-query.dto';
import { IssuesService } from '../services/issues.service';

/**
 * REST `/api/v1/me/inbox` — личный инбокс текущего пользователя:
 * задачи, в которых он assignee, во ВСЕХ проектах организации.
 *
 * Отдельный контроллер (не часть IssuesController), потому что:
 *   1. путь не привязан к `:projectId` — это глобальный список.
 *   2. cursor-пагинация (а не page/limit как у `/projects/:id/issues`).
 *   3. семантически другой потребитель: «мой рабочий день», не «таблица задач проекта».
 *
 * RBAC: `issue:read` на уровне tenant'а (любой member видит свой собственный список).
 * Frontend Wave 2: хук `useMyInbox` (`frontend/src/hooks/tracker/useMyInbox.ts`).
 */
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

  /**
   * Wave 2 polish T6-6a — счётчик задач в моём инбоксе для бейджа в
   * `TrackerBottomNav`. Чем легче запрос — тем меньше нагрузка при каждом
   * фокусе вкладки (SWR revalidateOnFocus). Возвращаем сразу пару
   * total/unread, чтобы фронт не делал второй запрос.
   *
   * До T6-6a фронт делал `GET /me/inbox?limit=1` и видел только «есть/нет»;
   * теперь backend отдаёт точное число.
   */
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

  // ── helpers ──

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
