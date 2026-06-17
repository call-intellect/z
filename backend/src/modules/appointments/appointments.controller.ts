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
  CreateAppointmentSchema,
  ListAppointmentsQuerySchema,
  UpdateAppointmentSchema,
  type AppointmentDto,
  type AppointmentTimelineItemDto,
  type CreateAppointmentDto,
  type ListAppointmentsQuery,
  type UpdateAppointmentDto,
} from './dto/appointments.dto';
import { AppointmentsService } from './services/appointments.service';

@ApiTags('appointments')
@Controller('api/v1/appointments')
@UseGuards(CookieAuthGuard, TenantGuard)
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService)
    private readonly appointments: AppointmentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список назначений с фильтрами' })
  async list(
    @Query(new ZodValidationPipe(ListAppointmentsQuerySchema))
    query: ListAppointmentsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: AppointmentDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.appointments.list({ tenantId: t, query });
  }

  @Get('persons/:personId/timeline')
  @ApiOperation({
    summary: 'Timeline всех назначений одного сотрудника (desc по validFrom)',
  })
  async personTimeline(
    @Param('personId') personId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: AppointmentTimelineItemDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.appointments.personTimeline({ tenantId: t, personId });
  }

  @Get('entities/:entityId/timeline')
  @ApiOperation({
    summary: 'Timeline по Entity{type=person}.id (резолв Person через Person.entityId)',
  })
  async entityTimeline(
    @Param('entityId') entityId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: AppointmentTimelineItemDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.appointments.personTimelineByEntity({
      tenantId: t,
      entityId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить назначение по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AppointmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.appointments.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать назначение (Person → Role + Department)' })
  async create(
    @Body(new ZodValidationPipe(CreateAppointmentSchema))
    body: CreateAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AppointmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.appointments.create({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить назначение' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAppointmentSchema))
    body: UpdateAppointmentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AppointmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.appointments.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Архивировать назначение (status=former + validTo=now)',
  })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AppointmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.appointments.softDelete({
      tenantId: t,
      userId: user.id,
      id,
    });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'appointment');
    if (!ok) {
      throw this.forbidden('Недостаточно прав для чтения назначений');
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'appointment');
    if (!ok) {
      throw this.forbidden('Изменять назначения может только владелец/администратор Org');
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'appointment',
      act: 'delete',
    });
    if (!ok) {
      throw this.forbidden('Архивировать назначения может только владелец/администратор Org');
    }
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
