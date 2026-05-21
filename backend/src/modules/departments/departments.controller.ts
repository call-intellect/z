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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  BatchCreateDepartmentsSchema,
  CreateDepartmentSchema,
  ListDepartmentsQuerySchema,
  UpdateDepartmentSchema,
  type BatchCreateDepartmentsDto,
  type CreateDepartmentDto,
  type DepartmentDto,
  type DepartmentListItemDto,
  type ListDepartmentsQuery,
  type UpdateDepartmentDto,
} from './dto/departments.dto';
import { DepartmentsService } from './services/departments.service';

/**
 * REST API отделов компании (Фаза 0a, группа А).
 *
 *   GET    /api/v1/departments?q=&includeDeleted=&limit=  — список.
 *   GET    /api/v1/departments/:id                        — один отдел.
 *   POST   /api/v1/departments                            — создать.
 *   POST   /api/v1/departments/batch                      — массовое создание.
 *   PATCH  /api/v1/departments/:id                        — обновить.
 *   DELETE /api/v1/departments/:id                        — soft-delete.
 *
 * RBAC ресурс — `department`. owner/admin — read/write/delete. manager — read.
 */
@ApiTags('departments')
@Controller('api/v1/departments')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DepartmentsController {
  constructor(
    @Inject(DepartmentsService) private readonly departments: DepartmentsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список отделов Org (фильтр q, includeDeleted, limit)' })
  async list(
    @Query(new ZodValidationPipe(ListDepartmentsQuerySchema)) q: ListDepartmentsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: DepartmentListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.departments.list({
      tenantId: t,
      q: q.q,
      includeDeleted: q.includeDeleted,
      limit: q.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить отдел по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DepartmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.departments.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать отдел' })
  async create(
    @Body(new ZodValidationPipe(CreateDepartmentSchema)) body: CreateDepartmentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DepartmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.departments.create({ tenantId: t, userId: user.id, body });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Массово создать отделы (пропускает дубли по имени)' })
  async createBatch(
    @Body(new ZodValidationPipe(BatchCreateDepartmentsSchema))
    body: BatchCreateDepartmentsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: DepartmentDto[]; created: number; skipped: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.departments.createBatch({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить отдел' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDepartmentSchema)) body: UpdateDepartmentDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DepartmentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.departments.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить отдел (soft-delete; должен быть пустым)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.departments.softDelete({ tenantId: t, userId: user.id, id });
  }

  // ─────────────────────────── helpers ──────────────────────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'department');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения отделов');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'department');
    if (!ok) throw this.forbidden('Изменять отделы может только владелец/администратор Org');
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'department',
      act: 'delete',
    });
    if (!ok) throw this.forbidden('Удалять отделы может только владелец/администратор Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
