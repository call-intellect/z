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
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import { DocumentImportService } from './document-import.service';
import { DocumentsService } from './documents.service';
import {
  CreateTextDumpSchema,
  type CreateTextDumpDto,
  type DocumentDetailDto,
  type DocumentDto,
  type DocumentExtractedEntitiesDto,
  type DocumentImportDto,
  ImportConfluenceBodySchema,
  type ImportConfluenceBodyDto,
  type ImportConfluenceResultDto,
  ImportZipBodySchema,
  type ImportZipBodyDto,
  type ImportZipResultDto,
  ListDocumentsQuerySchema,
  type ListDocumentsQuery,
  SetAttributionBodySchema,
  type SetAttributionBodyDto,
  toDecisionProvenance,
  toDocumentDto,
  toDocumentImportDto,
  toIdeaBlockSummaryDto,
  toMetricProvenance,
  toPolicyProvenance,
  toProcessProvenance,
  toRegulationProvenance,
  toToolProvenance,
  UploadDocumentBodySchema,
  type UploadDocumentBodyDto,
  type UploadDocumentResultDto,
  UploadDocumentQuerySchema,
  type UploadDocumentQuery,
} from './dto/documents.dto';

const UPLOAD_FILES_MAX_COUNT = 50;

@ApiTags('documents')
@Controller('api/v1/documents')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(DocumentImportService)
    private readonly imports: DocumentImportService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Загрузить документ(ы) (PDF/DOCX/XLSX/PPTX/MD/TXT/HTML/RTF/ODT/CSV). Поле `files` (несколько) или `file` (один, обратная совместимость).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Несколько файлов (ТЗ-4 Ф3)',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'Один файл (обратная совместимость)',
        },
        attachedRoleId: { type: 'string', description: 'Привязка к должности' },
        attachedThemeId: { type: 'string', description: 'Привязка к теме графа' },
        attachedProjectId: { type: 'string', description: 'Привязка к проекту' },
        docType: {
          type: 'string',
          enum: ['regulation', 'policy', 'instruction', 'process', 'job_description', 'other'],
          description: 'Смысловой тип документа',
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'files', maxCount: UPLOAD_FILES_MAX_COUNT },
      { name: 'file', maxCount: 1 },
    ]),
  )
  async upload(
    @UploadedFiles()
    uploaded: { files?: MulterFile[]; file?: MulterFile[] } | undefined,
    @Query(new ZodValidationPipe(UploadDocumentQuerySchema))
    query: UploadDocumentQuery,
    @Body(new ZodValidationPipe(UploadDocumentBodySchema))
    body: UploadDocumentBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UploadDocumentResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);

    const rawFiles = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
    if (rawFiles.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Файл обязателен' },
      });
    }
    const person = await this.requirePerson(t, user.id);

    return this.documents.uploadMany({
      tenantId: t,
      uploaderPersonId: person.id,
      files: rawFiles.map((f) => ({
        buffer: f.buffer,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      })),
      attachedRoleId: body.attachedRoleId ?? query.attachedRoleId,
      attachedThemeId: body.attachedThemeId,
      attachedProjectId: body.attachedProjectId,
      docType: body.docType,
    });
  }

  @Post('text')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать текстовый дамп (без файла, ≤50 000 символов)' })
  async createTextDump(
    @Body(new ZodValidationPipe(CreateTextDumpSchema))
    body: CreateTextDumpDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; status: 'queued' }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const person = await this.requirePerson(t, user.id);
    return this.documents.createTextDump({
      tenantId: t,
      uploaderPersonId: person.id,
      userId: user.id,
      content: body.content,
    });
  }

  @Post('import-zip')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Массовый импорт документов из ZIP-архива (ТЗ-4 Ф7/Ф8). Поле `file` = .zip; поддержанные внутри файлы станут отдельными документами. `source=notion` — экспорт Notion (имена страниц чистятся от 32-hex id).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'ZIP-архив' },
        source: {
          type: 'string',
          enum: ['upload_zip', 'notion'],
          description:
            'Источник архива: `upload_zip` (обычный, по умолчанию) или `notion` (экспорт Notion).',
        },
        attachedThemeId: { type: 'string', description: 'Привязка к теме графа (для всех файлов)' },
        attachedProjectId: { type: 'string', description: 'Привязка к проекту (для всех файлов)' },
        docType: {
          type: 'string',
          enum: ['regulation', 'policy', 'instruction', 'process', 'job_description', 'other'],
          description: 'Смысловой тип документа (для всех файлов)',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importZip(
    @UploadedFile() file: MulterFile | undefined,
    @Body(new ZodValidationPipe(ImportZipBodySchema))
    body: ImportZipBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportZipResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    if (!file) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Архив обязателен' },
      });
    }
    const person = await this.requirePerson(t, user.id);

    const { importId } = await this.imports.createBatch({
      tenantId: t,
      createdById: person.id,
      zip: { buffer: file.buffer, size: file.size },
      source: body.source,
      attachedThemeId: body.attachedThemeId,
      attachedProjectId: body.attachedProjectId,
      docType: body.docType,
    });

    await this.coreQueue.enqueueDocumentImport({ tenantId: t, importId });
    return { importId };
  }

  @Post('import-confluence')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Импорт страниц пространства Confluence Cloud (ТЗ-4 Ф9). JSON-тело с подключением; страницы пространства станут отдельными документами. API-токен шифруется и НЕ хранится в БД.',
  })
  async importConfluence(
    @Body(new ZodValidationPipe(ImportConfluenceBodySchema))
    body: ImportConfluenceBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ImportConfluenceResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const person = await this.requirePerson(t, user.id);

    const { importId } = await this.imports.createConfluenceImport({
      tenantId: t,
      createdById: person.id,
      attachedThemeId: body.attachedThemeId,
      attachedProjectId: body.attachedProjectId,
      docType: body.docType,
    });

    const encryptedToken = this.imports.encryptConfluenceToken(body.apiToken);
    await this.coreQueue.enqueueDocumentImport({
      tenantId: t,
      importId,
      confluence: {
        baseUrl: body.baseUrl,
        email: body.email,
        spaceKey: body.spaceKey,
        encryptedToken,
      },
    });
    return { importId };
  }

  @Get()
  @ApiOperation({ summary: 'Список документов Org' })
  async list(
    @Query(new ZodValidationPipe(ListDocumentsQuerySchema))
    q: ListDocumentsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: DocumentDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const { items, total } = await this.documents.list({
      tenantId: t,
      limit: q.limit,
      offset: q.offset,
      attachedRoleId: q.attachedRoleId,
    });
    return { items: items.map(toDocumentDto), total };
  }

  @Get('imports/:id')
  @ApiOperation({
    summary:
      'Статус batch-импорта (ТЗ-4 Волна 2). Прогресс {doneFiles}/{totalFiles} + errorLog. owner/admin, tenant-scoped.',
  })
  async getImportStatus(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DocumentImportDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const row = await this.documents.getImportStatus({
      tenantId: t,
      importId: id,
    });
    return toDocumentImportDto(row);
  }

  @Patch(':id/attribution')
  @ApiOperation({
    summary:
      'Установить/изменить смысловую атрибуцию документа (тип/тема/проект) и принять подсказку Коры (ТЗ-4 Волна 2). owner/admin, tenant-scoped. Проецирует привязку в граф для блоков документа.',
  })
  async setAttribution(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetAttributionBodySchema))
    body: SetAttributionBodyDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DocumentDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    const updated = await this.documents.setAttribution({
      tenantId: t,
      documentId: id,
      docType: body.docType,
      attachedThemeId: body.attachedThemeId,
      attachedProjectId: body.attachedProjectId,
    });
    return toDocumentDto(updated);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Деталка документа + parsedText + IdeaBlock-и; для owner/admin — provenance группы Б (Process/Decision/...).',
  })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<DocumentDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);

    const canSeeExtracted = await this.rbac.canRead(user.id, t, 'process');

    const detail = await this.documents.getDetail({
      tenantId: t,
      documentId: id,
      includeExtracted: canSeeExtracted,
    });

    const result: DocumentDetailDto = {
      document: toDocumentDto(detail.document),
      parsedText: detail.document.parsedText,
      ideaBlocks: detail.ideaBlocks.map(toIdeaBlockSummaryDto),
    };
    if (canSeeExtracted) {
      const extracted: DocumentExtractedEntitiesDto = {
        processes: detail.extracted.processes.map(toProcessProvenance),
        decisions: detail.extracted.decisions.map(toDecisionProvenance),
        regulations: detail.extracted.regulations.map(toRegulationProvenance),
        policies: detail.extracted.policies.map(toPolicyProvenance),
        metrics: detail.extracted.metrics.map(toMetricProvenance),
        tools: detail.extracted.tools.map(toToolProvenance),
      };
      result.extractedEntities = extracted;
    }
    return result;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete документа' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.documents.softDelete({ tenantId: t, documentId: id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения документов',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'document');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для загрузки документов',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'document',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Удаление документов доступно только owner/admin',
        },
      });
    }
  }

  private async requirePerson(tenantId: string, userId: string): Promise<{ id: string }> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message:
            'У вашей учётной записи нет привязанной персоны в этой организации. Завершите онбординг (Фаза 0).',
        },
      });
    }
    return person;
  }
}
