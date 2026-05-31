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
  CreateRowBodySchema,
  type CreateRowBody,
  type RowViewDto,
  RowsListQuerySchema,
  type RowsListQuery,
  UpdateRowBodySchema,
  type UpdateRowBody,
  toRowViewDto,
} from '../dto/tables.dto';
import { TableRowsService } from '../services/table-rows.service';
import { TablesService } from '../services/tables.service';

/**
 * Smart Tables — REST CRUD строк (`TableRow`).
 *
 *   GET    /api/v1/tables/:tableId/rows                    — список (paginated)
 *   POST   /api/v1/tables/:tableId/rows                    — создать строку
 *   GET    /api/v1/tables/:tableId/rows/:rowId             — карточка строки
 *   PATCH  /api/v1/tables/:tableId/rows/:rowId             — обновить
 *   POST   /api/v1/tables/:tableId/rows/:rowId/archive     — в архив (soft)
 *   POST   /api/v1/tables/:tableId/rows/:rowId/unarchive   — из архива
 *   DELETE /api/v1/tables/:tableId/rows/:rowId             — hard-delete
 *
 * RBAC: ресурс `table` (строки — содержимое таблицы; отдельного RBAC-ресурса
 * не плодим, чтобы не было риска прокола при добавлении views).
 */
@ApiTags('tables')
@ApiBearerAuth()
@Controller('api/v1/tables/:tableId/rows')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TableRowsController {
  constructor(
    @Inject(TableRowsService) private readonly rows: TableRowsService,
    @Inject(TablesService) private readonly tables: TablesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список строк таблицы (с пагинацией)' })
  @ApiOkResponse({ description: 'Строки таблицы + total' })
  async list(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(RowsListQuerySchema)) q: RowsListQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: RowViewDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const { items, total } = await this.rows.list({
      tenantId: t,
      tableId,
      query: q,
    });
    return { items: items.map(toRowViewDto), total };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать строку' })
  async create(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(CreateRowBodySchema)) body: CreateRowBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RowViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.rows.create({
      tenantId: t,
      tableId,
      userId: user.id,
      input: body,
    });
    return toRowViewDto(row);
  }

  @Get(':rowId')
  @ApiOperation({ summary: 'Карточка строки по id' })
  async byId(
    @Param('tableId') tableId: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RowViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    // Проверка что строка действительно в этой таблице (защита от ошибок client'а).
    const row = await this.rows.findById({ tenantId: t, rowId });
    if (row.tableId !== tableId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'row_table_mismatch', message: 'Строка принадлежит другой таблице' },
      });
    }
    return toRowViewDto(row);
  }

  @Patch(':rowId')
  @ApiOperation({ summary: 'Обновить строку' })
  async update(
    @Param('tableId') tableId: string,
    @Param('rowId') rowId: string,
    @Body(new ZodValidationPipe(UpdateRowBodySchema)) body: UpdateRowBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RowViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const existing = await this.rows.findById({ tenantId: t, rowId });
    if (existing.tableId !== tableId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'row_table_mismatch', message: 'Строка принадлежит другой таблице' },
      });
    }
    const row = await this.rows.update({ tenantId: t, rowId, input: body });
    return toRowViewDto(row);
  }

  @Post(':rowId/archive')
  @ApiOperation({ summary: 'Архивировать строку (soft)' })
  async archive(
    @Param('tableId') tableId: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RowViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.rows.archive({ tenantId: t, rowId });
    if (row.tableId !== tableId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'row_table_mismatch', message: 'Строка принадлежит другой таблице' },
      });
    }
    return toRowViewDto(row);
  }

  @Post(':rowId/unarchive')
  @ApiOperation({ summary: 'Восстановить строку из архива' })
  async unarchive(
    @Param('tableId') tableId: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<RowViewDto> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireWrite(user.id, t, table.createdBy);
    const row = await this.rows.unarchive({ tenantId: t, rowId });
    if (row.tableId !== tableId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'row_table_mismatch', message: 'Строка принадлежит другой таблице' },
      });
    }
    return toRowViewDto(row);
  }

  @Delete(':rowId')
  @ApiOperation({ summary: 'Удалить строку безвозвратно (только архивную)' })
  async hardDelete(
    @Param('tableId') tableId: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string }> {
    const t = this.requireTenant(tenantId);
    const table = await this.tables.findById({ tenantId: t, id: tableId });
    await this.requireDelete(user.id, t, table.createdBy);
    const existing = await this.rows.findById({ tenantId: t, rowId });
    if (existing.tableId !== tableId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'row_table_mismatch', message: 'Строка принадлежит другой таблице' },
      });
    }
    return this.rows.hardDelete({ tenantId: t, rowId });
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
        error: { code: 'forbidden', message: 'Недостаточно прав для чтения строк' },
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
        error: { code: 'forbidden', message: 'Недостаточно прав для изменения строк' },
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
        error: { code: 'forbidden', message: 'Недостаточно прав для удаления строк' },
      });
    }
  }
}
