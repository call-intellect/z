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
  BatchCreateRolesSchema,
  CreateRoleSchema,
  ListRolesQuerySchema,
  UpdateRoleSchema,
  type BatchCreateRolesDto,
  type CreateRoleDto,
  type ListRolesQuery,
  type RoleDto,
  type RoleListItemDto,
  type UpdateRoleDto,
} from './dto/roles-domain.dto';
import { RolesDomainService } from './services/roles-domain.service';

/**
 * REST API бизнес-должностей (Role) — Фаза 0a, группа А.
 *
 *   GET    /api/v1/roles?q=&departmentId=&includeDeleted=&limit=
 *   GET    /api/v1/roles/:id
 *   POST   /api/v1/roles
 *   POST   /api/v1/roles/batch
 *   PATCH  /api/v1/roles/:id
 *   DELETE /api/v1/roles/:id
 *
 * RBAC ресурс — `role` (НЕ путать с MembershipRole — это бизнес-должность).
 */
@ApiTags('roles-domain')
@Controller('api/v1/roles')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RolesDomainController {
  constructor(
    @Inject(RolesDomainService) private readonly roles: RolesDomainService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список должностей Org' })
  async list(
    @Query(new ZodValidationPipe(ListRolesQuerySchema)) q: ListRolesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: RoleListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.roles.list({
      tenantId: t,
      q: q.q,
      departmentId: q.departmentId,
      includeDeleted: q.includeDeleted,
      limit: q.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить должность по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.roles.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать должность (одновременно создаётся RoleProfile)' })
  async create(
    @Body(new ZodValidationPipe(CreateRoleSchema)) body: CreateRoleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.roles.create({ tenantId: t, userId: user.id, body });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Массово создать должности (пропускает дубли)' })
  async createBatch(
    @Body(new ZodValidationPipe(BatchCreateRolesSchema)) body: BatchCreateRolesDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: RoleDto[]; created: number; skipped: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.roles.createBatch({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить должность' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) body: UpdateRoleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RoleDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.roles.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить должность (soft-delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.roles.softDelete({ tenantId: t, userId: user.id, id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'role');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения должностей');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'role');
    if (!ok) throw this.forbidden('Изменять должности может только владелец/администратор Org');
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'role',
      act: 'delete',
    });
    if (!ok) throw this.forbidden('Удалять должности может только владелец/администратор Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
