import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  CreateKpiSchema,
  KpiMeasurementSchema,
  ListKpiQuerySchema,
  UpdateKpiSchema,
  type CreateKpiDto,
  type KpiDto,
  type KpiMeasurementDto,
  type ListKpiQuery,
  type UpdateKpiDto,
} from './dto/kpi.dto';
import { KpiService } from './services/kpi.service';

@ApiTags('kpi')
@Controller('api/v1/kpi')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KpiController {
  constructor(
    @Inject(KpiService) private readonly kpi: KpiService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список KPI с фильтрами' })
  async list(
    @Query(new ZodValidationPipe(ListKpiQuerySchema)) query: ListKpiQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: KpiDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.kpi.list({ tenantId: t, query });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить KPI по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KpiDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.kpi.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Создать KPI (Metric с attachedTo*Id). Требуется хотя бы один attached*Id.',
  })
  async create(
    @Body(new ZodValidationPipe(CreateKpiSchema)) body: CreateKpiDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KpiDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.kpi.create({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить KPI' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateKpiSchema)) body: UpdateKpiDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KpiDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.kpi.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить KPI (hard delete Metric-записи)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.kpi.delete({ tenantId: t, userId: user.id, id });
  }

  @Patch(':id/measurement')
  @ApiOperation({
    summary: 'Атомарное обновление currentValue + lastMeasuredAt (опц. currentValueUnit)',
  })
  async measurement(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(KpiMeasurementSchema))
    body: KpiMeasurementDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<KpiDto> {
    const t = this.requireTenant(tenantId);
    await this.requireManage(user.id, t);
    return this.kpi.measurement({ tenantId: t, userId: user.id, id, body });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'kpi');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения KPI');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'kpi');
    if (!ok) {
      throw this.forbidden('Изменять KPI может только владелец/администратор Org');
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'kpi',
      act: 'delete',
    });
    if (!ok) {
      throw this.forbidden('Удалять KPI может только владелец/администратор Org');
    }
  }

  private async requireManage(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'kpi',
      act: 'manage',
    });
    if (!ok) {
      throw this.forbidden('Регистрировать измерения KPI может только владелец/администратор Org');
    }
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
