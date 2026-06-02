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

import { TypedConfigService } from '../../../common/config/index';
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
  CreateTableFromSchemaBodySchema,
  type CreateTableFromSchemaBody,
  InferSchemaBodySchema,
  type InferSchemaBody,
  type InferredTableSchemaDto,
  type TableViewDto,
  TablesListQuerySchema,
  type TablesListQuery,
  UpdateTableBodySchema,
  type UpdateTableBody,
  toTableViewDto,
} from '../dto/tables.dto';
import { TableAgentService } from '../services/table-agent.service';
import { TablePropertiesService } from '../services/table-properties.service';
import { TablesService } from '../services/tables.service';

/** AdminSetting-ключ feature-flag Text-to-Schema (default off). */
const FEATURE_TABLES_TEXT_TO_SCHEMA = 'feature.tables_text_to_schema';

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
    @Inject(TableAgentService) private readonly tableAgent: TableAgentService,
    @Inject(TablePropertiesService)
    private readonly properties: TablePropertiesService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ──────────────────── Text-to-Schema (Фаза 1, за feature-flag) ───────────

  @Post('infer-schema')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Предложить схему таблицы по текстовому описанию (превью)',
  })
  @ApiOkResponse({ description: 'Сгенерированная схема таблицы (без создания)' })
  async inferSchema(
    @Body(new ZodValidationPipe(InferSchemaBodySchema)) body: InferSchemaBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<InferredTableSchemaDto> {
    const t = this.requireTenant(tenantId);
    await this.requireFeatureEnabled();
    await this.requireWrite(user.id, t);
    return this.tableAgent.inferSchemaFromText({
      tenantId: t,
      userPrompt: body.prompt,
    });
  }

  @Post('from-schema')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать таблицу из (отредактированной) схемы' })
  @ApiOkResponse({ description: 'Созданная таблица' })
  async createFromSchema(
    @Body(new ZodValidationPipe(CreateTableFromSchemaBodySchema))
    body: CreateTableFromSchemaBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TableViewDto> {
    const t = this.requireTenant(tenantId);
    await this.requireFeatureEnabled();
    await this.requireWrite(user.id, t);
    const row = await this.tables.create({
      tenantId: t,
      userId: user.id,
      input: {
        name: body.name,
        ...(body.description != null ? { description: body.description } : {}),
        ...(body.icon != null ? { icon: body.icon } : {}),
        ...(body.entitySync
          ? { entitySync: { type: body.entitySync.type, autoCreate: false } }
          : {}),
      },
    });
    await this.properties.createMany({
      tenantId: t,
      tableId: row.id,
      properties: body.properties.map((p) => ({
        name: p.name,
        type: p.type,
        isPrimary: p.isPrimary,
        ...(p.config ? { config: p.config } : {}),
      })),
    });
    return toTableViewDto(row);
  }

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

  /**
   * Smart-tables auto-creation (Фаза 1) — гейт по feature-flag.
   * `feature.tables_text_to_schema` (AdminSetting, default false). Если выключен —
   * `403 feature_tables_text_to_schema_disabled`.
   */
  private async requireFeatureEnabled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      FEATURE_TABLES_TEXT_TO_SCHEMA,
      undefined,
      false,
    );
    if (enabled !== true) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'feature_tables_text_to_schema_disabled',
          message: 'Создание таблиц по описанию пока отключено в этой организации',
        },
      });
    }
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
