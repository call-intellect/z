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
import {
  ListStatesQuerySchema,
  type ListStatesQuery,
} from '../dto/states/list-states-query.dto';
import type { ListStatesResponse } from '../dto/states/state-response.dto';
import { StatesService } from '../services/states.service';

/**
 * REST `/api/v1/states` — справочник статусов (`IssueState`) для трекера.
 *
 * Read-only endpoint, нужен фронту для:
 *   - рендера board-колонок (статус = колонка);
 *   - фильтра «Статус» в списке задач (включая `/me/inbox`);
 *   - валидации drag-and-drop переходов на UI.
 *
 * RBAC: используем `project` resource — отдельного `issue_state` в RBAC
 * нет, а семантически право видеть states проекта = праву видеть проект
 * (states — это атрибут конфигурации проекта).
 */
@ApiTags('tracker / states')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class StatesController {
  constructor(
    @Inject(StatesService) private readonly svc: StatesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('states')
  @ApiOperation({
    summary: 'Список статусов задач (IssueState) текущей организации',
    description:
      'Опциональные фильтры: ?projectId=...&category=started. Без projectId — все states организации.',
  })
  @ApiResponse({ status: 200, description: 'Список IssueState' })
  @ApiResponse({ status: 400, description: 'Validation error / tenant_required' })
  @ApiResponse({ status: 403, description: 'Недостаточно прав на чтение проектов' })
  async list(
    @Query(new ZodValidationPipe(ListStatesQuerySchema)) query: ListStatesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListStatesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(t, query);
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
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение проектов' },
      });
    }
  }
}
