import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { MeetingVisibilityService } from '../../meetings/meeting-visibility.service';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type { ListIssuesResponse } from '../dto/issues/issue-response.dto';
import {
  ListOrgIssuesQuerySchema,
  type ListOrgIssuesQuery,
} from '../dto/issues/list-org-issues-query.dto';
import { IssuesService } from '../services/issues.service';

/**
 * REST `/api/v1/issues` — сквозной список задач ВСЕЙ организации (рабочий стол
 * «Задачи»). В отличие от `/projects/:projectId/issues` (per-project) и
 * `/me/inbox` (только мои) — кросс-проектная выборка с видимостью по роли и
 * `Org.visibilityMode` (Р3/Р4). Маршрут `issues` (без `:id`) свободен:
 * в `IssuesController` есть только `issues/:id`, `issues/by-identifier/:identifier`.
 *
 * RBAC: `issue:read` на уровне tenant'а; строковую видимость (свои vs все)
 * применяет `IssuesService.findAllAcrossProjects` по контексту из RbacService.
 */
@ApiTags('tracker / issues')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class OrgIssuesController {
  constructor(
    @Inject(IssuesService) private readonly svc: IssuesService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(MeetingVisibilityService)
    private readonly meetingVisibility: MeetingVisibilityService,
  ) {}

  @Get('issues')
  @ApiOperation({
    summary: 'Сквозной список задач всей организации (рабочий стол «Задачи»)',
    description:
      'Кросс-проектная выборка Issue с фильтрами projectId/assigneeUserId/' +
      'linkedMeetingId/stateCategory/priority/cycleId/labelId/q и пагинацией ' +
      'page/limit. linkedMeetingId — задачи, связанные с конкретной встречей. ' +
      'Видимость: руководитель (owner/admin/coo) или visibilityMode=open — все ' +
      'задачи; manager+strict — только свои (assignee=self или создатель). ' +
      'Каждый item несёт stateCategory для группировки по 5 колонкам.',
  })
  @ApiResponse({ status: 200, description: 'items + total + page + limit' })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение задач' })
  async list(
    @Query(new ZodValidationPipe(ListOrgIssuesQuerySchema))
    query: ListOrgIssuesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListIssuesResponse> {
    const t = this.requireTenant(tenantId);
    const canRead = await this.rbac.canRead(user.id, t, 'issue');
    if (!canRead) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
    const ctx = await this.rbac.loadContext(user.id, t);
    if (!ctx) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
    const isLeadership =
      ctx.isSuperAdmin ||
      ctx.role === 'owner' ||
      ctx.role === 'admin' ||
      ctx.role === 'coo';
    let meetingAuthorized = false;
    if (query.linkedMeetingId) {
      await this.meetingVisibility.assertCanView(query.linkedMeetingId, user.id);
      meetingAuthorized = true;
    }
    return this.svc.findAllAcrossProjects(t, user.id, query, {
      isLeadership,
      visibility: ctx.visibility,
      meetingAuthorized,
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
}
