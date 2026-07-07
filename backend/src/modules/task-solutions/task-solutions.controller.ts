import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListTaskSolutionsQuerySchema,
  type ListTaskSolutionsQuery,
  type ListTaskSolutionsResponse,
  type TaskSolutionDetailDto,
  type TaskSolutionHistoryResponse,
  type TaskSolutionSourcesResponse,
  type TaskSolutionSummaryResponse,
} from './dto/task-solutions.dto';
import { TaskSolutionsService } from './services/task-solutions.service';

@ApiTags('task-solutions')
@Controller('api/v1/task-solutions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TaskSolutionsController {
  constructor(
    @Inject(TaskSolutionsService) private readonly svc: TaskSolutionsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список решений задач Org (с фильтрами и пагинацией)' })
  async list(
    @Query(new ZodValidationPipe(ListTaskSolutionsQuerySchema))
    query: ListTaskSolutionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListTaskSolutionsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, query });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Сводка по решениям задач: всего · кандидаты · недельный прирост' })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TaskSolutionSummaryResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getSummary(t);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить решение задачи по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TaskSolutionDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, id });
  }

  @Get(':id/sources')
  @ApiOperation({ summary: 'Цитаты-первоисточники решения задачи (провенанс)' })
  async sources(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TaskSolutionSourcesResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getSources({ tenantId: t, id });
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Timeline версий решения задачи (CardVersion)' })
  async history(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TaskSolutionHistoryResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getHistory({ tenantId: t, id });
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Подтвердить актуальность (отметить lastConfirmedAt = now)' })
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; lastConfirmedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.confirm({ tenantId: t, id });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить решение задачи (мягкое удаление, только owner/admin)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.softDelete({ tenantId: t, id, actorUserId: user.id });
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Восстановить удалённое решение задачи (только owner/admin)' })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.restore({ tenantId: t, id, actorUserId: user.id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'regulation');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения решений задач',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'regulation',
      act: 'write',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут изменять решения задач',
        },
      });
    }
  }
}
