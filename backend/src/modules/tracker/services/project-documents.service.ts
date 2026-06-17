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

const PREVIEW_MAX_LEN = 240;

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

  async listForProject(projectId: string, tenantId: string): Promise<ProjectDocumentSummaryDto[]> {
    await this.projects.requireProject(projectId, tenantId);
    const rows = await this.prisma.projectDocument.findMany({
      where: { projectId, tenantId, deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toSummary(r));
  }

  async findById(id: string, tenantId: string): Promise<ProjectDocumentResponseDto> {
    const doc = await this.requireDocument(id, tenantId);
    return this.toResponse(doc);
  }

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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
      if (dto.parentId !== null) {
        if (dto.parentId === id) {
          throw new ConflictException({
            ok: false,
            error: {
              code: 'project_document_self_parent',
              message: 'Документ не может быть родителем самого себя',
            },
          });
        }
        let cursorId: string | null = dto.parentId;
        const visited = new Set<string>();
        while (cursorId !== null) {
          if (cursorId === id) {
            throw new ConflictException({
              ok: false,
              error: {
                code: 'project_document_cyclic_parent',
                message:
                  'Цикл в дереве документов: новый parent ведёт обратно к текущему документу',
              },
            });
          }
          if (visited.has(cursorId)) break;
          visited.add(cursorId);
          const node: { parentId: string | null } | null =
            await this.prisma.projectDocument.findUnique({
              where: { id: cursorId },
              select: { parentId: true },
            });
          cursorId = node?.parentId ?? null;
        }
      }
      data.parent =
        dto.parentId === null ? { disconnect: true } : { connect: { id: dto.parentId } };
      changedFields.push('parentId');
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== existing.sortOrder) {
      data.sortOrder = dto.sortOrder;
      changedFields.push('sortOrder');
    }

    if (changedFields.length === 0) {
      return this.toResponse(existing);
    }

    let updated: ProjectDocument;
    try {
      updated = await this.prisma.projectDocument.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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

  async delete(id: string, tenantId: string): Promise<{ ok: true }> {
    const existing = await this.requireDocument(id, tenantId);
    const now = new Date();

    const subtreeIds: string[] = [existing.id];
    let frontier: string[] = [existing.id];
    while (frontier.length > 0) {
      const children = await this.prisma.projectDocument.findMany({
        where: {
          tenantId,
          parentId: { in: frontier },
          deletedAt: null,
        },
        select: { id: true },
      });
      frontier = children.map((c) => c.id);
      subtreeIds.push(...frontier);
    }
    await this.prisma.projectDocument.updateMany({
      where: { id: { in: subtreeIds }, tenantId, deletedAt: null },
      data: { deletedAt: now },
    });

    for (const docId of subtreeIds) {
      this.events.publishProjectDocumentDeleted({
        tenantId,
        projectId: existing.projectId,
        documentId: docId,
      });
    }
    return { ok: true };
  }

  async restore(id: string, tenantId: string): Promise<ProjectDocumentResponseDto> {
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

  async duplicate(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<ProjectDocumentResponseDto> {
    const src = await this.requireDocument(id, tenantId);
    const baseTitle = `${src.title} (копия)`;
    let title = baseTitle;
    let attempt = 1;
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

  async listLinkedCards(projectId: string, tenantId: string): Promise<LinkedCardDto[]> {
    await this.projects.requireProject(projectId, tenantId);
    this.metrics.incLinkedCardsView({ tenant: tenantId, project: projectId });

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

  private async requireDocument(id: string, tenantId: string): Promise<ProjectDocument> {
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

  private emptyContent(): Prisma.InputJsonValue {
    return { type: 'doc', content: [] };
  }

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
