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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
  type ImportAnalyzeDto,
  ImportCommitBodySchema,
  type ImportCommitBody,
  type ImportCommitResultDto,
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
import type { InferredTableSchema } from '../services/table-agent.service';
import { TableAgentService } from '../services/table-agent.service';
import { TableFileParserService } from '../services/table-file-parser.service';
import { TableImportService } from '../services/table-import.service';
import { TablePropertiesService } from '../services/table-properties.service';
import { TablesService } from '../services/tables.service';

/**
 * Минимальный тип multer-файла. Объявлен локально, чтобы не зависеть от
 * опционального `@types/multer` (как в documents.controller.ts).
 */
interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** AdminSetting-ключ feature-flag Text-to-Schema (default off). */
const FEATURE_TABLES_TEXT_TO_SCHEMA = 'feature.tables_text_to_schema';

/**
 * Жёсткий DoS-предохранитель на размер загружаемого файла импорта (multer
 * `limits.fileSize`). Чуть выше дефолтного admin-лимита `importMaxFileMb`:
 * точный конфигурируемый лимит проверяется в коде (даёт понятное сообщение),
 * а этот потолок не даёт multer буферизовать гигантский файл в память.
 */
const IMPORT_FILE_HARD_LIMIT_BYTES = 30 * 1024 * 1024;

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
    // Document-to-Table (Фаза 4).
    @Inject(TableFileParserService)
    private readonly fileParser: TableFileParserService,
    @Inject(TableImportService) private readonly importer: TableImportService,
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

  // ──────────────────── Document-to-Table (Фаза 4) ────────────────────────

  @Post('import/analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Разобрать загруженный Excel/CSV: предложить схему + кандидатов на слияние',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ description: 'Схема + первые строки + кандидаты на слияние' })
  @UseInterceptors(
    FileInterceptor('file', {
      // DoS-предохранитель: один файл, размер ≤ жёсткого потолка. Точный
      // конфигурируемый лимит проверяется ниже (понятное сообщение). Превышение
      // multer-лимита маппится в 400 (см. catch ниже).
      limits: { fileSize: IMPORT_FILE_HARD_LIMIT_BYTES, files: 1 },
    }),
  )
  async importAnalyze(
    @UploadedFile() file: MulterFile | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportAnalyzeDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    if (!file) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Файл обязателен' },
      });
    }
    if (file.size === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_empty', message: 'Файл пустой' },
      });
    }
    const maxBytes = this.cfg.smartTables.importMaxFileBytes;
    if (file.size > maxBytes) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'import_file_too_large',
          message: `Файл превышает лимит ${this.cfg.smartTables.importMaxFileMb} МБ`,
        },
      });
    }

    const parsed = await this.fileParser.parseFileToTable({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    });

    // Лимит строк на импорт (admin/ENV) — обрезаем то, что переносим дальше.
    // ВАЖНО: в ответ отдаём ВСЕ limitedRows (до importMaxRows), НЕ режем до 500 —
    // иначе фронт отправит в commit только первые 500 и строки 501..N потеряются.
    // commit-DTO пропускает до `rows.max(5000)`.
    const maxRows = this.cfg.smartTables.importMaxRows;
    const rawRowsCount = parsed.rows.length;
    const limitedRows = parsed.rows.slice(0, maxRows);

    const schema = await this.tableAgent.inferSchemaFromTabular({
      tenantId: t,
      headers: parsed.headers,
      sampleRows: limitedRows,
    });

    const mergeCandidates = await this.tableAgent.findSimilarTables({
      tenantId: t,
      schema,
    });

    return {
      schema,
      rows: limitedRows,
      rawRowsCount,
      // truncated = файл реально длиннее лимита импорта importMaxRows.
      truncated: rawRowsCount > limitedRows.length,
      truncatedColumns: parsed.truncatedColumns,
      mergeCandidates,
    };
  }

  @Post('import/commit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Материализовать импорт: создать таблицу или слить строки в существующую',
  })
  @ApiOkResponse({ description: 'Результат импорта (tableId, rowsCreated, entitiesLinked)' })
  async importCommit(
    @Body(new ZodValidationPipe(ImportCommitBodySchema)) body: ImportCommitBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportCommitResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    // Приводим Zod-схему к InferredTableSchema (нормализуем optional → null).
    const schema: InferredTableSchema = {
      name: body.schema.name,
      description: body.schema.description ?? null,
      icon: body.schema.icon ?? null,
      entitySync: body.schema.entitySync ?? null,
      properties: body.schema.properties.map((p) => ({
        name: p.name,
        type: p.type,
        isPrimary: p.isPrimary,
        ...(p.config ? { config: p.config } : {}),
      })),
    };

    if (body.mode === 'merge') {
      return this.importer.commitMerge({
        tenantId: t,
        userId: user.id,
        targetTableId: body.targetTableId as string,
        schema,
        rows: body.rows,
      });
    }
    return this.importer.commitCreate({
      tenantId: t,
      userId: user.id,
      schema,
      rows: body.rows,
    });
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
