import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
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
  QuickCreateSprintSchema,
  type QuickCreateSprintDto,
  type QuickCreateSprintResponse,
} from '../dto/sprints/quick-create-sprint.dto';
import {
  ListSprintsQuerySchema,
  type ListSprintsQuery,
  type ListSprintsResponse,
} from '../dto/sprints/sprint-list-item.dto';
import { SprintsService } from '../services/sprints.service';

/**
 * Sprints (2026-05-28) — REST для master-detail списка и мастера создания.
 *
 *   GET  /api/v1/sprints              — org-wide список с фильтрами/сортировкой
 *   POST /api/v1/sprints/quick-create — атомарное создание Project+Cycle+Board+States
 *
 * RBAC ресурс — `cycle`: read/write. См. policy.csv.
 *
 * Idempotency-Key для quick-create обрабатывается общим middleware (см.
 * `app.module.ts` — путь добавлен в `IdempotencyMiddleware.forRoutes`).
 */
@ApiTags('tracker / sprints')
@ApiBearerAuth()
@Controller('api/v1/sprints')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SprintsController {
  constructor(
    @Inject(SprintsService) private readonly sprints: SprintsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Org-wide список спринтов (master-detail) с фильтрами и сортировкой',
  })
  async list(
    @Query(new ZodValidationPipe(ListSprintsQuerySchema)) query: ListSprintsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListSprintsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.sprints.list({ tenantId: t, query });
  }

  @Post('quick-create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Создать спринт: Project (если scope!="project") + Cycle + Board + IssueStates атомарно',
    description:
      'При scope="project" переиспользует existingProjectId и создаёт только Cycle. ' +
      'Slug и identifier для нового Project генерируются на backend с авторазрешением коллизий. ' +
      'Идемпотентность: передавай заголовок Idempotency-Key (8..128 символов) для безопасного повтора.',
  })
  async quickCreate(
    @Body(new ZodValidationPipe(QuickCreateSprintSchema)) body: QuickCreateSprintDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<QuickCreateSprintResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.sprints.quickCreate({ tenantId: t, dto: body, userId: user.id });
  }

  // ─────────────────────────── helpers ─────────────────────────────────

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
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения спринтов',
        },
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
          message: 'Недостаточно прав для создания спринтов',
        },
      });
    }
  }
}
