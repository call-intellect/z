import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
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
  CreateExperimentBodySchema,
  type CreateExperimentBody,
  type ExperimentDetailDto,
  ListExperimentsQuerySchema,
  type ListExperimentsQuery,
  type ListExperimentsResponse,
  TransitionExperimentBodySchema,
  type TransitionExperimentBody,
  UpdateExperimentBodySchema,
  type UpdateExperimentBody,
} from './dto/experiments.dto';
import { ExperimentsService } from './services/experiments.service';

@ApiTags('experiments')
@Controller('api/v1/experiments')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ExperimentsController {
  constructor(
    @Inject(ExperimentsService) private readonly svc: ExperimentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список экспериментов Org (фильтры status / owner_entity_id / q + пагинация)',
  })
  async list(
    @Query(new ZodValidationPipe(ListExperimentsQuerySchema))
    q: ListExperimentsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListExperimentsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, query: q });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить эксперимент по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ExperimentDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, id });
  }

  @Post()
  @ApiOperation({ summary: 'Создать эксперимент вручную' })
  async create(
    @Body(new ZodValidationPipe(CreateExperimentBodySchema))
    body: CreateExperimentBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ExperimentDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create({ tenantId: t, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить эксперимент (частичное обновление полей)' })
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateExperimentBodySchema))
    body: UpdateExperimentBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ExperimentDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update({ tenantId: t, id, body });
  }

  @Post(':id/transition')
  @ApiOperation({
    summary: 'Сменить статус эксперимента (running / completed / dropped / paused)',
  })
  async transition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TransitionExperimentBodySchema))
    body: TransitionExperimentBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ExperimentDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.transition({ tenantId: t, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Архивировать эксперимент (soft-delete → status=dropped)' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.svc.softDelete({ tenantId: t, id });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'experiment');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для просмотра экспериментов',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'experiment');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin / manager могут редактировать эксперименты.',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'experiment',
      act: 'delete',
      resourceOwnerId: null,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут архивировать эксперименты.',
        },
      });
    }
  }
}
