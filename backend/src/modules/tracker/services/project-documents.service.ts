import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProjectDocument } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateProjectDocumentDto,
  LinkedCardDto,
  ProjectDocumentResponseDto,
  ProjectDocumentSummaryDto,
  UpdateProjectDocumentDto,
} from '../dto/project-documents/project-document.dto';

import { ProjectsService } from './projects.service';
import { TrackerEmitterService } from './tracker-emitter.service';
import { TrackerEventsService } from './tracker-events.service';

/** Длина preview (plain text) в списке документов. */
const PREVIEW_MAX_LEN = 240;

/**
 * ProjectDocumentsService — CRUD документов проекта + список «Связанные карточки».
 *
 * ТЗ: plans/tz/2026-05-27-tracker-project-documents.md.
 *
 * Ключевые принципы:
 *   - tenantId фильтрует все запросы (multi-tenancy).
 *   - `requireProject` через `ProjectsService` — единая точка проверки 404.
 *   - На каждый create/update эмитим `tracker.project_document_changed` для
 *     knowledge-core (TrackerAdapter создаст RawEvent).
 *   - WS-события (`project_document.{created,updated,deleted}`) — через
 *     `TrackerEventsService` (fire-and-forget).
 *   - Soft-delete: `deletedAt`. `restore` снимает `deletedAt`.
 *   - Уникальность `(projectId, title)`: при коллизии — 409
 *     `project_document_title_taken`.
 *   - Sortable: при create — `sortOrder = max+1` (новые в конце); PATCH с
 *     `sortOrder` или `pinned` меняет порядок (UI делает DnD reorder).
 */
@Injectable()
export class ProjectDocumentsService {
  private readonly logger = new Logger(ProjectDocumentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────

  /** Список документов проекта (плоский, без удалённых). */
  async listForProject(
    projectId: string,
    tenantId: string,
  ): Promise<ProjectDocumentSummaryDto[]> {
    await this.projects.requireProject(projectId, tenantId);
    const rows = await this.prisma.projectDocument.findMany({
      where: { projectId, tenantId, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** Один документ с полным контентом. */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const doc = await this.requireDocument(id, tenantId);
    return this.toResponse(doc);
  }

  /** Создать документ. Доступ: project member, RBAC уровень — в контроллере. */
  async create(
    projectId: string,
    dto: CreateProjectDocumentDto,
    tenantId: string,
    userId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const project = await this.projects.requireProject(projectId, tenantId);

    if (dto.parentId) {
      const parent = await this.prisma.projectDocument.findFirst({
        where: {
          id: dto.parentId,
          projectId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!parent) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'project_document_parent_not_found',
            message: 'Родительский документ не найден в этом проекте',
          },
        });
      }
    }

    // sortOrder = max+1 (новые в конце списка, выше — только pinned).
    const max = await this.prisma.projectDocument.aggregate({
      where: { projectId, tenantId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (max._max.sortOrder ?? -1) + 1;

    let created: ProjectDocument;
    try {
      created = await this.prisma.projectDocument.create({
        data: {
          tenantId,
          projectId: project.id,
          title: dto.title,
          content: (dto.content ?? this.emptyContent()) as Prisma.InputJsonValue,
          contentHtml: dto.contentHtml ?? null,
          contentStripped: dto.contentStripped ?? null,
          parentId: dto.parentId ?? null,
          sortOrder: nextSortOrder,
          createdById: userId,
          updatedById: userId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'project_document_title_taken',
            message: 'Документ с таким названием уже есть в проекте',
          },
        });
      }
      throw err;
    }

    this.metrics.incProjectDocumentCreated({
      tenant: tenantId,
      project: project.id,
    });

    const summary = this.toSummary(created);
    this.events.publishProjectDocumentCreated(summary, tenantId);
    this.emitter.emitProjectDocumentChanged({
      tenantId,
      projectId: project.id,
      documentId: created.id,
      title: created.title,
      fullText: created.contentStripped ?? null,
      actorUserId: userId,
      occurredAt: created.createdAt,
      changeType: 'created',
    });

    return this.toResponse(created);
  }

  /**
   * PATCH документа. Возвращает полный response (с контентом).
   *
   * `userId` — для проверки author/admin permission в контроллере; здесь —
   * только заполняем `updatedById`.
   */
  async update(
    id: string,
    dto: UpdateProjectDocumentDto,
    tenantId: string,
    userId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const existing = await this.requireDocument(id, tenantId);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'project_document_parent_self',
            message: 'Документ не может быть родителем самого себя',
          },
        });
      }
      const parent = await this.prisma.projectDocument.findFirst({
        where: {
          id: dto.parentId,
          projectId: existing.projectId,
          tenantId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!parent) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'project_document_parent_not_found',
            message: 'Родительский документ не найден в этом проекте',
          },
        });
      }
    }

    const changedFields: string[] = [];
    const data: Prisma.ProjectDocumentUpdateInput = { updatedById: userId };
    if (dto.title !== undefined && dto.title !== existing.title) {
      data.title = dto.title;
      changedFields.push('title');
    }
    if (dto.content !== undefined) {
      data.content = dto.content as Prisma.InputJsonValue;
      changedFields.push('content');
    }
    if (dto.contentHtml !== undefined) {
      data.contentHtml = dto.contentHtml;
      if (!changedFields.includes('content')) changedFields.push('content');
    }
    if (dto.contentStripped !== undefined) {
      data.contentStripped = dto.contentStripped;
      if (!changedFields.includes('content')) changedFields.push('content');
    }
    if (dto.pinned !== undefined && dto.pinned !== existing.pinned) {
      data.pinned = dto.pinned;
      changedFields.push('pinned');
    }
    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      data.parent =
        dto.parentId === null
          ? { disconnect: true }
          : { connect: { id: dto.parentId } };
      changedFields.push('parentId');
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== existing.sortOrder) {
      data.sortOrder = dto.sortOrder;
      changedFields.push('sortOrder');
    }

    if (changedFields.length === 0) {
      // Ничего не меняли — возвращаем как есть, БЕЗ side-effects.
      return this.toResponse(existing);
    }

    let updated: ProjectDocument;
    try {
      updated = await this.prisma.projectDocument.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'project_document_title_taken',
            message: 'Документ с таким названием уже есть в проекте',
          },
        });
      }
      throw err;
    }

    this.metrics.incProjectDocumentUpdated({
      tenant: tenantId,
      project: updated.projectId,
    });

    const summary = this.toSummary(updated);
    this.events.publishProjectDocumentUpdated(summary, tenantId, changedFields);

    // В knowledge-core — только если изменился контент (или title — title
    // используется LLM как контекст).
    if (changedFields.includes('content') || changedFields.includes('title')) {
      this.emitter.emitProjectDocumentChanged({
        tenantId,
        projectId: updated.projectId,
        documentId: updated.id,
        title: updated.title,
        fullText: updated.contentStripped ?? null,
        actorUserId: userId,
        occurredAt: updated.updatedAt,
        changeType: 'updated',
      });
    }

    return this.toResponse(updated);
  }

  /** Soft-delete (deletedAt). Восстановить — `restore`. */
  async delete(id: string, tenantId: string): Promise<{ ok: true }> {
    const existing = await this.requireDocument(id, tenantId);
    await this.prisma.projectDocument.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    this.events.publishProjectDocumentDeleted({
      tenantId,
      projectId: existing.projectId,
      documentId: existing.id,
    });
    return { ok: true };
  }

  /** Восстановить soft-deleted документ (deletedAt=null). */
  async restore(
    id: string,
    tenantId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'project_document_not_found',
          message: 'Документ не найден',
        },
      });
    }
    if (!doc.deletedAt) {
      // уже активен — возвращаем как есть, идемпотентно.
      return this.toResponse(doc);
    }
    const restored = await this.prisma.projectDocument.update({
      where: { id: doc.id },
      data: { deletedAt: null },
    });
    const summary = this.toSummary(restored);
    this.events.publishProjectDocumentCreated(summary, tenantId);
    return this.toResponse(restored);
  }

  /**
   * Duplicate: создать копию документа с suffix « (копия)». Использует
   * `create`, потому что нужны ровно те же побочки (metrics, WS, ingest).
   */
  async duplicate(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const src = await this.requireDocument(id, tenantId);
    const baseTitle = `${src.title} (копия)`;
    // Если уже есть «(копия)» — добавим суффикс с порядковым номером.
    let title = baseTitle;
    let attempt = 1;
    // Простая защита от бесконечного цикла (если 50+ копий) — отдаём 409.
    while (attempt < 50) {
      const collision = await this.prisma.projectDocument.findFirst({
        where: { projectId: src.projectId, title, deletedAt: null },
        select: { id: true },
      });
      if (!collision) break;
      attempt += 1;
      title = `${baseTitle} ${attempt}`;
    }
    if (attempt >= 50) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'project_document_title_taken',
          message: 'Слишком много копий — переименуйте оригинал',
        },
      });
    }

    return this.create(
      src.projectId,
      {
        title,
        content: src.content as unknown,
        contentHtml: src.contentHtml ?? undefined,
        contentStripped: src.contentStripped ?? undefined,
        parentId: src.parentId,
      },
      tenantId,
      userId,
    );
  }

  // ── Permissions helpers ────────────────────────────────────────────────

  /**
   * Author OR admin/owner may write/delete. RBAC даёт первый уровень (member
   * Org может read; manager open может write); per-resource ownership —
   * проверяем здесь, а не в controller'е (чтобы не дублировать SQL).
   *
   * `isAdmin` — флаг с уровня RBAC (admin/owner — `true`; manager — `false`).
   */
  async requireWritable(args: {
    documentId: string;
    tenantId: string;
    userId: string;
    isAdmin: boolean;
  }): Promise<ProjectDocument> {
    const doc = await this.requireDocument(args.documentId, args.tenantId);
    if (args.isAdmin) return doc;
    if (doc.createdById === args.userId) return doc;
    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'project_document_forbidden',
        message: 'Изменять документ может только автор или администратор',
      },
    });
  }

  // ── Linked cards ───────────────────────────────────────────────────────

  /**
   * Список CRM-карточек, связанных с проектом через подвязанные ко встречам
   * задачи. SQL: `Card ←(cardId)— Meeting —(linkedIssueId)→ Issue
   *                                                    (projectId=$1)`.
   *
   * Возвращает уникальные карточки, отсортированные по последней дате встречи
   * (`Meeting.createdAt DESC`).
   *
   * Лимит — 50 (TZ §linked-cards).
   */
  async listLinkedCards(
    projectId: string,
    tenantId: string,
  ): Promise<LinkedCardDto[]> {
    await this.projects.requireProject(projectId, tenantId);
    this.metrics.incLinkedCardsView({ tenant: tenantId, project: projectId });

    // Один SQL: JOIN Card ← Meeting ← Issue ← Project. DISTINCT ON по cardId.
    // Используем raw, потому что Prisma не умеет нативно сделать
    // `SELECT DISTINCT ON` с упорядочиванием.
    type Row = {
      id: string;
      name: string;
      kind: string;
      color: string;
      meetingCount: number;
      lastMeetingAt: Date | null;
      contactName: string | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (c."id")
        c."id",
        c."name",
        c."kind",
        c."color",
        c."meetingCount",
        c."lastMeetingAt",
        c."contactName"
      FROM "Card" c
      JOIN "Meeting" m ON m."cardId" = c."id"
      JOIN "Issue" i ON m."linkedIssueId" = i."id"
      WHERE i."projectId" = ${projectId}
        AND i."tenantId" = ${tenantId}
        AND i."deletedAt" IS NULL
        AND m."deletedAt" IS NULL
        AND c."deletedAt" IS NULL
      ORDER BY c."id", m."createdAt" DESC
      LIMIT 50
    `;

    // Sort by lastMeetingAt DESC уже после DISTINCT ON (DISTINCT ON ставит
    // первое попадание per cardId, упорядоченность по m.createdAt DESC задаёт
    // именно «последнюю встречу»).
    rows.sort((a, b) => {
      const aT = a.lastMeetingAt ? a.lastMeetingAt.getTime() : 0;
      const bT = b.lastMeetingAt ? b.lastMeetingAt.getTime() : 0;
      return bT - aT;
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      meetingCount: r.meetingCount,
      lastMeetingAt: r.lastMeetingAt ? r.lastMeetingAt.toISOString() : null,
      contactName: r.contactName,
    }));
  }

  // ── internal ───────────────────────────────────────────────────────────

  /**
   * Найти активный (не удалённый) документ + проверить tenant. Для restore
   * используется отдельный путь, который видит soft-deleted.
   */
  private async requireDocument(
    id: string,
    tenantId: string,
  ): Promise<ProjectDocument> {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!doc) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'project_document_not_found',
          message: 'Документ не найден',
        },
      });
    }
    return doc;
  }

  /** Минимальный валидный TipTap JSON (пустой doc). */
  private emptyContent(): Prisma.InputJsonValue {
    return { type: 'doc', content: [] };
  }

  /** Mapper: ProjectDocument → ProjectDocumentResponseDto (с контентом). */
  private toResponse(doc: ProjectDocument): ProjectDocumentResponseDto {
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      projectId: doc.projectId,
      title: doc.title,
      content: doc.content,
      contentHtml: doc.contentHtml,
      contentStripped: doc.contentStripped,
      parentId: doc.parentId,
      sortOrder: doc.sortOrder,
      pinned: doc.pinned,
      entityId: doc.entityId,
      createdById: doc.createdById,
      updatedById: doc.updatedById,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      deletedAt: doc.deletedAt?.toISOString() ?? null,
    };
  }

  /** Mapper: ProjectDocument → ProjectDocumentSummaryDto (без `content`). */
  private toSummary(doc: ProjectDocument): ProjectDocumentSummaryDto {
    const stripped = doc.contentStripped ?? '';
    const preview =
      stripped.length === 0
        ? null
        : stripped.length > PREVIEW_MAX_LEN
          ? `${stripped.slice(0, PREVIEW_MAX_LEN)}…`
          : stripped;
    return {
      id: doc.id,
      tenantId: doc.tenantId,
      projectId: doc.projectId,
      title: doc.title,
      preview,
      parentId: doc.parentId,
      sortOrder: doc.sortOrder,
      pinned: doc.pinned,
      entityId: doc.entityId,
      createdById: doc.createdById,
      updatedById: doc.updatedById,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
