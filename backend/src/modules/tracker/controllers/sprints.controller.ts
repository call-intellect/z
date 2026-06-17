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
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  QuickCreateSprintSchema,
  type QuickCreateSprintDto,
  type QuickCreateSprintResponse,
} from '../dto/sprints/quick-create-sprint.dto';
import type {
  SprintArchiveListDto,
  SprintArchivePeriod,
  SprintArchiveStatus,
} from '../dto/sprints/sprint-archive.dto';
import {
  ListSprintsQuerySchema,
  type ListSprintsQuery,
  type ListSprintsResponse,
} from '../dto/sprints/sprint-list-item.dto';
import { SprintArchiveService } from '../services/sprint-archive.service';
import { SprintsService } from '../services/sprints.service';

@ApiTags('tracker / sprints')
@ApiBearerAuth()
@Controller('api/v1/sprints')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SprintsController {
  constructor(
    @Inject(SprintsService) private readonly sprints: SprintsService,
    @Inject(SprintArchiveService)
    private readonly archive: SprintArchiveService,
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

  @Get('archive')
  @ApiOperation({
    summary: "Pulse §5.3 — Архив гипотез: хроника всех Cycle tenant'а за период",
  })
  async getArchive(
    @Query('period') period: string | undefined,
    @Query('status') statusRaw: string | undefined,
    @Query('q') q: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SprintArchiveListDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const validPeriod: SprintArchivePeriod =
      period === 'month' || period === 'quarter' || period === 'year' ? period : 'quarter';
    const statusFilter: SprintArchiveStatus | 'all' | undefined =
      statusRaw === 'completed' ||
      statusRaw === 'in_progress' ||
      statusRaw === 'cancelled' ||
      statusRaw === 'all'
        ? statusRaw
        : undefined;
    return this.archive.getArchive({
      tenantId: t,
      period: validPeriod,
      statusFilter,
      query: q,
    });
  }

  @Post('quick-create')
  @RequireSubscription()
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
