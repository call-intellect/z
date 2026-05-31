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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

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
  CreateTableBodySchema,
  type CreateTableBody,
  type TableViewDto,
  TablesListQuerySchema,
  type TablesListQuery,
  UpdateTableBodySchema,
  type UpdateTableBody,
  toTableViewDto,
} from '../dto/tables.dto';
import { TablesService } from '../services/tables.service';

/**
 * Smart Tables — REST CRUD верхнего уровня (Table).
 *
 *   POST   /api/v1/tables             — создать таблицу
 *   GET    /api/v1/tables             — список (active / archived / all)
 *   GET    /api/v1/tables/:id         — карточка таблицы
 *   PATCH  /api/v1/tables/:id         — обновить
 *   POST   /api/v1/tables/:id/archive — в архив (soft)
 *   POST   /api/v1/tables/:id/unarchive — из архива
 *   DELETE /api/v1/tables/:id         — hard-delete (только архивная)
 *
 * RBAC: ресурс `table`. read — все member'ы Org; write/delete — owner/admin/
 * manager-self (см. policy.csv §Smart Tables). super_admin — bypass.
 *
 * Multi-tenancy: `TenantGuard` обязателен.
 */
@ApiTags('tables')
@ApiBearerAuth()
@Controller('api/v1/tables')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TablesController {
  constructor(
    @Inject(TablesService) private readonly tables: TablesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать таблицу' })
  @ApiOkResponse({ description: 'Созданная таблица' })
  async create(
    @Body(new ZodValidationPipe(CreateTableBodySchema)) body: CreateTableBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const row = await this.tables.create({
      tenantId: t,
      userId: user.id,
      input: body,
    });
    return toTableViewDto(row);
  }

  @Get()
  @ApiOperation({ summary: 'Список таблиц Org (active / archived / all)' })
  async list(
    @Query(new ZodValidationPipe(TablesListQuerySchema)) q: TablesListQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: TableViewDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const { items, total } = await this.tables.list({ tenantId: t, query: q });
    return { items: items.map(toTableViewDto), total };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка таблицы по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const row = await this.tables.findById({ tenantId: t, id });
    return toTableViewDto(row);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить поля таблицы' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTableBodySchema)) body: UpdateTableBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    const existing = await this.tables.findById({ tenantId: t, id });
    await this.requireWrite(user.id, t, existing.createdBy);
    const row = await this.tables.update({ tenantId: t, id, input: body });
    return toTableViewDto(row);
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Перевести таблицу в архив (soft)' })
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    const existing = await this.tables.findById({ tenantId: t, id });
    await this.requireWrite(user.id, t, existing.createdBy);
    const row = await this.tables.archive({ tenantId: t, id });
    return toTableViewDto(row);
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Восстановить таблицу из архива' })
  async unarchive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    const existing = await this.tables.findById({ tenantId: t, id });
    await this.requireWrite(user.id, t, existing.createdBy);
    const row = await this.tables.unarchive({ tenantId: t, id });
    return toTableViewDto(row);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить таблицу безвозвратно (только архивную)' })
  async hardDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    const existing = await this.tables.findById({ tenantId: t, id });
    await this.requireDelete(user.id, t, existing.createdBy);
    return this.tables.hardDelete({ tenantId: t, id });
  }

  // ─────────────────────────── helpers ────────────────────────────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'table');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения таблиц',
        },
      });
    }
  }

  private async requireWrite(
    userId: string,
    tenantId: string,
    ownerUserId?: string,
  ): Promise<void> {
    const ok = await this.rbac.canWrite(
      userId,
      tenantId,
      'table',
      ownerUserId ?? null,
    );
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для изменения таблицы',
        },
      });
    }
  }

  private async requireDelete(
    userId: string,
    tenantId: string,
    ownerUserId?: string,
  ): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'table',
      act: 'delete',
      resourceOwnerId: ownerUserId ?? null,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для удаления таблицы',
        },
      });
    }
  }
}
