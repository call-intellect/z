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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { TypedConfigService } from '../../../common/config/index';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
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
  SemanticFilterBodySchema,
  type SemanticFilterBody,
  type SemanticFilterResultDto,
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
import { TableSemanticFilterService } from '../services/table-semantic-filter.service';
import { TablesService } from '../services/tables.service';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const FEATURE_TABLES_TEXT_TO_SCHEMA = 'feature.tables_text_to_schema';

const IMPORT_FILE_HARD_LIMIT_BYTES = 30 * 1024 * 1024;

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
    @Inject(TableFileParserService)
    private readonly fileParser: TableFileParserService,
    @Inject(TableImportService) private readonly importer: TableImportService,
    @Inject(TableSemanticFilterService)
    private readonly semanticFilter: TableSemanticFilterService,
  ) {}

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

  @Post(':id/semantic-filter')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Конвертировать NL-запрос в JSON-фильтр таблицы (LLM + кэш)',
  })
  @ApiOkResponse({
    description: 'Очищенный против схемы набор условий фильтра + флаг cached',
  })
  async semanticFilterQuery(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SemanticFilterBodySchema))
    body: SemanticFilterBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SemanticFilterResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.semanticFilter.parseSemanticFilter({
      tenantId: t,
      tableId: id,
      nlQuery: body.nlQuery,
    });
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
    const ok = await this.rbac.canWrite(userId, tenantId, 'table', ownerUserId ?? null);
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
