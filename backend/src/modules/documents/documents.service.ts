import { randomUUID } from 'node:crypto';

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
  type DocumentKind,
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

/**
 * Фаза C1 «метка доверия»: критические сущности группы Б (process / decision /
 * regulation / policy) несут `currentVersion.trustTier` для провенанса документа.
 * metric / tool — без версионирования (currentVersion нет), их не расширяем.
 */
type WithTrustTier<T> = T & { currentVersion: { trustTier: TrustTier } | null };

/**
 * `DocumentsService` (Фаза 0b knowledge-core).
 *
 *   - `upload(...)` — основной путь для бинарных документов (PDF/DOCX/MD).
 *     ≤ inlineThreshold (по умолчанию 10 MiB) — `inlineContent` в БД;
 *     иначе — S3 (`documents/<tenantId>/<documentId>.bin`). После create —
 *     публикует `core.document-uploaded`.
 *
 *   - `createTextDump(...)` — короткий путь для дампов из формы `/dump`.
 *     Делегирует в `DumpService.createTextDocumentAndPublish` (он же
 *     создаёт Document {kind:'text', status:'parsed'} и публикует
 *     `core.dump-created`).
 *
 *   - `get(...)`, `list(...)`, `softDelete(...)` — обычный CRUD под tenantId.
 *
 * RBAC controller'а проверяется через `RbacService.canRead/canWrite('document')`
 * (policy.csv пополнен). Здесь — только tenantId-scope.
 */
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

  // ─────────────────────────── upload (multipart) ───────────────────────

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
    const { tenantId, uploaderPersonId, file, attachedRoleId } = args;

    // 1. Лимит размера. Жёсткая проверка до записи в БД, чтобы не плодить
    //    Document.status='failed' c "слишком большим".
    if (file.size > this.cfg.document.maxSizeBytes) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'document_too_large',
          message: `Файл превышает лимит ${this.cfg.document.maxSizeMb} МБ`,
        },
      });
    }
    if (file.size === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'document_empty', message: 'Файл пустой' },
      });
    }

    // 2. Определяем kind по MIME и расширению.
    const kind = detectKind(file.mimeType, file.originalName);

    // 3. Если задан attachedRoleId — убеждаемся, что Role принадлежит Org.
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

    // 4. Решаем inline vs S3 storage.
    const useS3 = file.size > this.cfg.document.inlineThresholdBytes;
    let s3Key: string | null = null;

    if (useS3) {
      // Заранее генерим id для предсказуемого s3-пути. Document.id сам
      // выставится cuid'ом — но мы держим ОТДЕЛЬНЫЙ суффикс ради S3 ключа,
      // чтобы s3 PUT шёл до INSERT (если INSERT упадёт — S3 безвреден).
      const objectKey = `documents/${tenantId}/${randomUUID()}.bin`;
      await this.s3.putObject({
        key: objectKey,
        body: file.buffer,
        contentType: file.mimeType,
      });
      s3Key = objectKey;
    }

    // 5. Создаём Document.
    // Prisma 7 для `Bytes`-поля ожидает `Uint8Array<ArrayBuffer>`. Buffer (с
    // ArrayBufferLike) сам по себе не совместим — копируем в чистый Uint8Array.
    const inlineBytes = useS3 ? null : Uint8Array.from(file.buffer);
    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        uploaderId: uploaderPersonId,
        kind,
        name: file.originalName.slice(0, 500),
        mimeType: file.mimeType.slice(0, 100),
        s3Key,
        inlineContent: inlineBytes,
        originalSize: file.size,
        status: 'uploaded',
        attachedRoleId: attachedRoleId ?? null,
      },
    });

    // 6. Публикуем job для DocumentIngestAdapter.
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
      },
      'documents.upload: Document создан, document.uploaded опубликован',
    );

    return { id: doc.id, status: doc.status };
  }

  // ─────────────────────────── createTextDump (для /dumps) ──────────────

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

  // ─────────────────────────── get / list / delete ──────────────────────

  async get(args: {
    tenantId: string;
    documentId: string;
  }): Promise<Document> {
    const doc = await this.prisma.document.findUnique({
      where: { id: args.documentId },
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
        orderBy: { createdAt: 'desc' },
        take: args.limit ?? 50,
        skip: args.offset ?? 0,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Получить provenance группы Б + IdeaBlock'и для документа (Фаза 0b §10).
   *
   * Алгоритм:
   *   1. Находим все RawEvent'ы для этого документа (по
   *      `sourceExternalId='doc:<id>'`).
   *   2. Через них — все IdeaBlockEvidence → IdeaBlock'и.
   *   3. Из IdeaBlock'ов: Decision-сущности (по `sourceIdeaBlockId`).
   *   4. Из EntityLink с `toEntityId=documentId, toType='document',
   *      relationType='derived_from'` (или `produces` от Process) — берём
   *      Process/Regulation/Policy/Metric/Tool.
   *
   * RBAC и доступ к самому документу проверяются в контроллере; этот метод
   * получает уже валидный documentId.
   */
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

    // 1. Ищем IdeaBlock'и через RawEvent → IdeaBlockEvidence.
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

    // Если admin/owner не запросил — не делаем тяжёлых запросов на group-Б.
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

    // 2. Decision через sourceIdeaBlockId.
    const decisions =
      blockIds.length > 0
        ? await this.prisma.decision.findMany({
            where: {
              tenantId: args.tenantId,
              sourceIdeaBlockId: { in: blockIds },
            },
            include: { currentVersion: { select: { trustTier: true } } },
            orderBy: { decidedAt: 'desc' },
          })
        : [];

    // 3. Group Б через EntityLink. derived_from → Document.
    //    fromType ∈ {process, regulation, policy, metric, tool}, toType=document,
    //    toEntityId = documentId.
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
      // fromType nullable в EntityLink (legacy = 'entity'); пропускаем легаси
      // и любые не-group-Б рёбра, которые не должны попадать в provenance документа.
      if (l.fromType !== null && l.fromType in byType) {
        byType[l.fromType as keyof typeof byType].push(l.fromEntityId);
      }
    }

    const [processes, regulations, policies, metrics, tools] = await Promise.all([
      byType.process.length > 0
        ? this.prisma.process.findMany({
            where: { id: { in: byType.process }, tenantId: args.tenantId },
            include: { currentVersion: { select: { trustTier: true } } },
          })
        : Promise.resolve<WithTrustTier<Process>[]>([]),
      byType.regulation.length > 0
        ? this.prisma.regulation.findMany({
            where: { id: { in: byType.regulation }, tenantId: args.tenantId },
            include: { currentVersion: { select: { trustTier: true } } },
          })
        : Promise.resolve<WithTrustTier<Regulation>[]>([]),
      byType.policy.length > 0
        ? this.prisma.policy.findMany({
            where: { id: { in: byType.policy }, tenantId: args.tenantId },
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
}

// ─────────────────────────── helpers ─────────────────────────────────────

/**
 * Определяет `DocumentKind` по MIME и расширению. Совпадает с подходом в
 * ТЗ §4.1 (pdf/docx/markdown/text/other). При неуверенности (octet-stream)
 * — пробуем по расширению, иначе `other` (адаптер откажет с `failed`).
 */
function detectKind(mimeType: string, fileName: string): DocumentKind {
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
