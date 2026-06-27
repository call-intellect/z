import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type Decision,
  type Document,
  type DocumentImport,
  type DocumentKind,
  type DocumentStatus,
  type DocumentType,
  type IdeaBlock,
  type Metric,
  type Policy,
  type Process,
  type Regulation,
  type Tool,
  type TrustTier,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { DumpService } from '../ingest/adapters/web-form/dump.service';
import { S3Service } from '../recordings/s3.service';

type WithTrustTier<T> = T & { currentVersion: { trustTier: TrustTier } | null };

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(DumpService) private readonly dumps: DumpService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}


  async uploadMany(args: {
    tenantId: string;
    uploaderPersonId: string;
    files: Array<{
      buffer: Buffer;
      originalName: string;
      mimeType: string;
      size: number;
    }>;
    attachedRoleId?: string;
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
  }): Promise<{
    items: Array<{
      id: string;
      status: DocumentStatus;
      name: string;
      deduped: boolean;
    }>;
  }> {
    const {
      tenantId,
      uploaderPersonId,
      files,
      attachedRoleId,
      attachedThemeId,
      attachedProjectId,
      docType,
    } = args;

    if (files.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Файл обязателен' },
      });
    }

    const limits = await this.cfg.documentLimits();
    if (files.length > limits.maxFilesPerUpload) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'too_many_files',
          message: `За одну загрузку можно отправить не более ${limits.maxFilesPerUpload} файлов`,
        },
      });
    }
    const accepted = new Set(limits.acceptedFormats.map((f) => f.toLowerCase()));

    const prepared = files.map((file) => {
      const kind = detectKind(file.mimeType, file.originalName);
      const ext = formatToken(kind, file.originalName);
      if (!accepted.has(ext)) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'unsupported_format',
            message: `Формат «${ext}» не поддерживается (файл «${file.originalName}»)`,
          },
        });
      }
      if (file.size > limits.maxSizeBytes) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'file_too_large',
            message: `Файл «${file.originalName}» превышает лимит ${limits.maxSizeMb} МБ`,
          },
        });
      }
      if (file.size === 0) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'document_empty',
            message: `Файл «${file.originalName}» пустой`,
          },
        });
      }
      return { file, kind };
    });

    await this.assertAttributionBelongsToTenant({
      tenantId,
      attachedRoleId,
      attachedThemeId,
      attachedProjectId,
    });

    const items: Array<{
      id: string;
      status: DocumentStatus;
      name: string;
      deduped: boolean;
    }> = [];
    for (const { file, kind } of prepared) {
      const item = await this.createOne({
        tenantId,
        uploaderPersonId,
        file,
        kind,
        attachedRoleId,
        attachedThemeId,
        attachedProjectId,
        docType,
      });
      items.push(item);
    }

    return { items };
  }

  async createOne(args: {
    tenantId: string;
    uploaderPersonId: string;
    file: {
      buffer: Buffer;
      originalName: string;
      mimeType: string;
      size: number;
    };
    kind?: DocumentKind;
    attachedRoleId?: string;
    attachedThemeId?: string;
    attachedProjectId?: string;
    docType?: DocumentType;
    importBatchId?: string;
  }): Promise<{
    id: string;
    status: DocumentStatus;
    name: string;
    deduped: boolean;
  }> {
    const {
      tenantId,
      uploaderPersonId,
      file,
      attachedRoleId,
      attachedThemeId,
      attachedProjectId,
      docType,
      importBatchId,
    } = args;
    const kind = args.kind ?? detectKind(file.mimeType, file.originalName);
    const name = file.originalName.slice(0, 500);
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    const existing = await this.prisma.document.findFirst({
      where: { tenantId, contentHash, deletedAt: null },
      select: { id: true, status: true },
    });
    if (existing) {
      this.logger.log(
        { tenantId, existingId: existing.id, contentHash, name },
        'documents.createOne: дубль по contentHash — Document не создан',
      );
      return { id: existing.id, status: existing.status, name, deduped: true };
    }

    const useS3 = file.size > this.cfg.document.inlineThresholdBytes;
    let s3Key: string | null = null;
    if (useS3) {
      const objectKey = `documents/${tenantId}/${randomUUID()}.bin`;
      await this.s3.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: file.mimeType,
      });
      s3Key = objectKey;
    }

    const inlineBytes = useS3 ? null : Uint8Array.from(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        uploaderId: uploaderPersonId,
        kind,
        name,
        mimeType: file.mimeType.slice(0, 100),
        s3Key,
        inlineContent: inlineBytes,
        originalSize: file.size,
        status: 'uploaded',
        contentHash,
        attachedRoleId: attachedRoleId ?? null,
        attachedThemeId: attachedThemeId ?? null,
        attachedProjectId: attachedProjectId ?? null,
        docType: docType ?? null,
        importBatchId: importBatchId ?? null,
      },
    });

    await this.coreQueue.enqueueDocumentUploaded({
      tenantId,
      documentId: doc.id,
    });

    this.logger.log(
      {
        documentId: doc.id,
        tenantId,
        uploaderPersonId,
        kind,
        sizeBytes: file.size,
        storage: useS3 ? 's3' : 'inline',
        contentHash,
        importBatchId: importBatchId ?? null,
      },
      'documents.createOne: Document создан, document.uploaded опубликован',
    );

    return { id: doc.id, status: doc.status, name, deduped: false };
  }

  async upload(args: {
    tenantId: string;
    uploaderPersonId: string;
    file: {
      buffer: Buffer;
      originalName: string;
      mimeType: string;
      size: number;
    };
    attachedRoleId?: string;
  }): Promise<{ id: string; status: string }> {
    const { items } = await this.uploadMany({
      tenantId: args.tenantId,
      uploaderPersonId: args.uploaderPersonId,
      files: [args.file],
      attachedRoleId: args.attachedRoleId,
    });
    const first = items[0];
    if (!first) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'file_required', message: 'Файл обязателен' },
      });
    }
    return { id: first.id, status: first.status };
  }

  private async assertAttributionBelongsToTenant(args: {
    tenantId: string;
    attachedRoleId?: string;
    attachedThemeId?: string;
    attachedProjectId?: string;
  }): Promise<void> {
    const { tenantId, attachedRoleId, attachedThemeId, attachedProjectId } =
      args;

    if (attachedRoleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: attachedRoleId },
        select: { tenantId: true },
      });
      if (!role || role.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'role_not_found', message: 'Должность не найдена' },
        });
      }
    }
    if (attachedThemeId) {
      const theme = await this.prisma.theme.findUnique({
        where: { id: attachedThemeId },
        select: { tenantId: true },
      });
      if (!theme || theme.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'theme_not_found', message: 'Тема не найдена' },
        });
      }
    }
    if (attachedProjectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: attachedProjectId },
        select: { tenantId: true },
      });
      if (!project || project.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'project_not_found', message: 'Проект не найден' },
        });
      }
    }
  }


  async createTextDump(args: {
    tenantId: string;
    uploaderPersonId: string;
    userId: string;
    content: string;
  }): Promise<{ id: string; status: 'queued' }> {
    const documentId = await this.dumps.createTextDocumentAndPublish({
      tenantId: args.tenantId,
      uploaderPersonId: args.uploaderPersonId,
      userId: args.userId,
      text: args.content,
    });
    return { id: documentId, status: 'queued' };
  }


  async get(args: {
    tenantId: string;
    documentId: string;
  }): Promise<Document> {
    const doc = await this.prisma.document.findUnique({
      where: { id: args.documentId },
      include: {
        uploader: { select: { name: true } },
        attachedRole: { select: { name: true } },
      },
    });
    if (!doc || doc.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'document_not_found', message: 'Документ не найден' },
      });
    }
    if (doc.tenantId !== args.tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'foreign_tenant',
          message: 'Документ принадлежит другой Org',
        },
      });
    }
    return doc;
  }

  async list(args: {
    tenantId: string;
    limit?: number;
    offset?: number;
    attachedRoleId?: string;
  }): Promise<{ items: Document[]; total: number }> {
    const where: Prisma.DocumentWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      ...(args.attachedRoleId ? { attachedRoleId: args.attachedRoleId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        include: {
          uploader: { select: { name: true } },
          attachedRole: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { items, total };
  }

  async getDetail(args: {
    tenantId: string;
    documentId: string;
    includeExtracted: boolean;
  }): Promise<{
    document: Document;
    ideaBlocks: IdeaBlock[];
    extracted: {
      processes: WithTrustTier<Process>[];
      decisions: WithTrustTier<Decision>[];
      regulations: WithTrustTier<Regulation>[];
      policies: WithTrustTier<Policy>[];
      metrics: Metric[];
      tools: Tool[];
    };
  }> {
    const document = await this.get({
      tenantId: args.tenantId,
      documentId: args.documentId,
    });

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        rawEvent: {
          tenantId: args.tenantId,
          sourceExternalId: `doc:${args.documentId}`,
        },
        block: { tenantId: args.tenantId },
      },
      select: { blockId: true },
      distinct: ['blockId'],
    });
    const blockIds = evidence.map((e) => e.blockId);

    const ideaBlocks =
      blockIds.length > 0
        ? await this.prisma.ideaBlock.findMany({
            where: {
              id: { in: blockIds },
              tenantId: args.tenantId,
            },
            orderBy: { createdAt: 'asc' },
          })
        : [];

    const empty: {
      processes: WithTrustTier<Process>[];
      decisions: WithTrustTier<Decision>[];
      regulations: WithTrustTier<Regulation>[];
      policies: WithTrustTier<Policy>[];
      metrics: Metric[];
      tools: Tool[];
    } = {
      processes: [],
      decisions: [],
      regulations: [],
      policies: [],
      metrics: [],
      tools: [],
    };
    if (!args.includeExtracted) {
      return { document, ideaBlocks, extracted: empty };
    }

    const decisions =
      blockIds.length > 0
        ? await this.prisma.decision.findMany({
            where: {
              tenantId: args.tenantId,
              deletedAt: null,
              sourceIdeaBlockId: { in: blockIds },
            },
            include: { currentVersion: { select: { trustTier: true } } },
            orderBy: { decidedAt: 'desc' },
          })
        : [];

    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        toEntityId: args.documentId,
        toType: 'document',
        relationType: { in: ['derived_from', 'produces'] },
        fromType: {
          in: ['process', 'regulation', 'policy', 'metric', 'tool'],
        },
      },
      select: { fromEntityId: true, fromType: true },
    });

    const byType = {
      process: [] as string[],
      regulation: [] as string[],
      policy: [] as string[],
      metric: [] as string[],
      tool: [] as string[],
    };
    for (const l of links) {
      if (l.fromType !== null && l.fromType in byType) {
        byType[l.fromType as keyof typeof byType].push(l.fromEntityId);
      }
    }

    const [processes, regulations, policies, metrics, tools] = await Promise.all([
      byType.process.length > 0
        ? this.prisma.process.findMany({
            where: { id: { in: byType.process }, tenantId: args.tenantId, deletedAt: null },
            include: { currentVersion: { select: { trustTier: true } } },
          })
        : Promise.resolve<WithTrustTier<Process>[]>([]),
      byType.regulation.length > 0
        ? this.prisma.regulation.findMany({
            where: { id: { in: byType.regulation }, tenantId: args.tenantId, deletedAt: null },
            include: { currentVersion: { select: { trustTier: true } } },
          })
        : Promise.resolve<WithTrustTier<Regulation>[]>([]),
      byType.policy.length > 0
        ? this.prisma.policy.findMany({
            where: { id: { in: byType.policy }, tenantId: args.tenantId, deletedAt: null },
            include: { currentVersion: { select: { trustTier: true } } },
          })
        : Promise.resolve<WithTrustTier<Policy>[]>([]),
      byType.metric.length > 0
        ? this.prisma.metric.findMany({
            where: { id: { in: byType.metric }, tenantId: args.tenantId },
          })
        : Promise.resolve<Metric[]>([]),
      byType.tool.length > 0
        ? this.prisma.tool.findMany({
            where: { id: { in: byType.tool }, tenantId: args.tenantId },
          })
        : Promise.resolve<Tool[]>([]),
    ]);

    return {
      document,
      ideaBlocks,
      extracted: { processes, decisions, regulations, policies, metrics, tools },
    };
  }

  async softDelete(args: {
    tenantId: string;
    documentId: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const doc = await this.get({
      tenantId: args.tenantId,
      documentId: args.documentId,
    });
    if (doc.deletedAt) {
      return {
        id: doc.id,
        deletedAt: doc.deletedAt.toISOString(),
      };
    }
    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
    this.logger.log(
      { documentId: doc.id, tenantId: args.tenantId },
      'documents: soft-delete',
    );
    return {
      id: updated.id,
      deletedAt: (updated.deletedAt ?? new Date()).toISOString(),
    };
  }


  async getImportStatus(args: {
    tenantId: string;
    importId: string;
  }): Promise<DocumentImport> {
    const row = await this.prisma.documentImport.findUnique({
      where: { id: args.importId },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'import_not_found', message: 'Импорт не найден' },
      });
    }
    return row;
  }


  async setAttribution(args: {
    tenantId: string;
    documentId: string;
    docType?: DocumentType | null;
    attachedThemeId?: string | null;
    attachedProjectId?: string | null;
  }): Promise<Document> {
    const { tenantId, documentId } = args;

    const doc = await this.get({ tenantId, documentId });

    await this.assertAttributionBelongsToTenant({
      tenantId,
      attachedThemeId: args.attachedThemeId ?? undefined,
      attachedProjectId: args.attachedProjectId ?? undefined,
    });

    const data: Prisma.DocumentUpdateInput = {
      suggestedDocType: null,
      suggestedThemeId: null,
    };
    if (args.docType !== undefined) data.docType = args.docType;
    if (args.attachedThemeId !== undefined) {
      data.attachedTheme = args.attachedThemeId
        ? { connect: { id: args.attachedThemeId } }
        : { disconnect: true };
    }
    if (args.attachedProjectId !== undefined) {
      data.attachedProject = args.attachedProjectId
        ? { connect: { id: args.attachedProjectId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.document.update({
      where: { id: doc.id },
      data,
    });

    await this.projectAttributionToBlocks({
      tenantId,
      documentId,
      attachedRoleId: updated.attachedRoleId,
      attachedThemeId: updated.attachedThemeId,
    });

    this.logger.log(
      {
        documentId,
        tenantId,
        docType: updated.docType,
        attachedThemeId: updated.attachedThemeId,
        attachedProjectId: updated.attachedProjectId,
      },
      'documents.setAttribution: атрибуция подтверждена + спроецирована в граф',
    );
    return updated;
  }

  private async projectAttributionToBlocks(args: {
    tenantId: string;
    documentId: string;
    attachedRoleId: string | null;
    attachedThemeId: string | null;
  }): Promise<void> {
    const { tenantId, documentId, attachedRoleId, attachedThemeId } = args;
    if (!attachedRoleId && !attachedThemeId) return;

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        rawEvent: {
          tenantId,
          sourceExternalId: `doc:${documentId}`,
        },
        block: { tenantId },
      },
      select: { blockId: true },
      distinct: ['blockId'],
    });
    const blockIds = evidence.map((e) => e.blockId);
    if (blockIds.length === 0) return;

    if (attachedRoleId) {
      await this.prisma.ideaBlock.updateMany({
        where: { id: { in: blockIds }, tenantId },
        data: { roleId: attachedRoleId, roleRelevant: true },
      });
    }
    if (attachedThemeId) {
      await this.prisma.themeIdeaBlock.createMany({
        data: blockIds.map((blockId) => ({
          themeId: attachedThemeId,
          blockId,
          tenantId,
          weight: new Prisma.Decimal('0.8'),
        })),
        skipDuplicates: true,
      });
    }
  }
}


export function detectKind(mimeType: string, fileName: string): DocumentKind {
  const mime = mimeType.toLowerCase();
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();

  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'docx';
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    return 'xlsx';
  }
  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  ) {
    return 'pptx';
  }
  if (
    mime === 'application/vnd.oasis.opendocument.text' ||
    ext === 'odt'
  ) {
    return 'odt';
  }
  if (
    mime === 'application/rtf' ||
    mime === 'text/rtf' ||
    ext === 'rtf'
  ) {
    return 'rtf';
  }
  if (mime === 'text/html' || ext === 'html' || ext === 'htm') {
    return 'html';
  }
  if (mime === 'text/csv' || ext === 'csv') return 'csv';
  if (
    mime === 'text/markdown' ||
    mime === 'text/x-markdown' ||
    ext === 'md' ||
    ext === 'markdown'
  ) {
    return 'markdown';
  }
  if (mime.startsWith('text/') || ext === 'txt') return 'text';
  return 'other';
}

export function formatToken(kind: DocumentKind, fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (ext && ext !== fileName.toLowerCase()) {
    if (ext === 'markdown') return 'md';
    if (ext === 'htm') return 'html';
    if (ext === 'xls') return 'xlsx';
    return ext;
  }
  switch (kind) {
    case 'markdown':
      return 'md';
    case 'text':
      return 'txt';
    default:
      return kind;
  }
}
