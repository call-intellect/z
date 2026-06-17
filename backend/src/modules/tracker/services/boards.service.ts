import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type Board } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { BoardResponseDto, ListBoardsResponse } from '../dto/boards/board-response.dto';
import type { CreateBoardDto, UpdateBoardDto } from '../dto/boards/board-schemas';

import { ProjectsService } from './projects.service';
import { TrackerEventsService } from './tracker-events.service';

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async ensureDefaultBoard(args: { tenantId: string; projectId: string }): Promise<string> {
    const existing = await this.prisma.board.findFirst({
      where: {
        projectId: args.projectId,
        tenantId: args.tenantId,
        isDefault: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.board.create({
        data: {
          tenantId: args.tenantId,
          projectId: args.projectId,
          name: 'Доска',
          color: '#5EEAD4',
          sequence: 0,
          isDefault: true,
        },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const fallback = await this.prisma.board.findFirst({
          where: {
            projectId: args.projectId,
            tenantId: args.tenantId,
            deletedAt: null,
          },
          orderBy: [{ isDefault: 'desc' }, { sequence: 'asc' }],
          select: { id: true },
        });
        if (fallback) return fallback.id;
      }
      throw e;
    }
  }

  async findAll(
    projectId: string,
    tenantId: string,
    options: { includeArchived: boolean },
  ): Promise<ListBoardsResponse> {
    await this.projects.requireProject(projectId, tenantId);
    const where: Prisma.BoardWhereInput = {
      projectId,
      tenantId,
      deletedAt: null,
    };
    if (!options.includeArchived) where.archivedAt = null;
    const boards = await this.prisma.board.findMany({
      where,
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
    });
    const counts = boards.length
      ? await this.prisma.issue.groupBy({
          by: ['boardId'],
          where: {
            boardId: { in: boards.map((b) => b.id) },
            deletedAt: null,
            archivedAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const countByBoardId = new Map<string, number>(
      counts.map((c) => [c.boardId ?? '', c._count._all]),
    );
    return {
      items: boards.map((b) => this.toResponse(b, countByBoardId.get(b.id) ?? 0)),
      total: boards.length,
    };
  }

  async findById(id: string, tenantId: string): Promise<BoardResponseDto> {
    const b = await this.requireBoard(id, tenantId);
    const count = await this.prisma.issue.count({
      where: { boardId: b.id, deletedAt: null, archivedAt: null },
    });
    return this.toResponse(b, count);
  }

  async create(
    projectId: string,
    dto: CreateBoardDto,
    tenantId: string,
    _userId: string,
  ): Promise<BoardResponseDto> {
    await this.projects.requireProject(projectId, tenantId);
    const agg = await this.prisma.board.aggregate({
      where: { projectId, tenantId, deletedAt: null },
      _max: { sequence: true },
    });
    const nextSequence = (agg._max.sequence ?? -1) + 1;
    try {
      const created = await this.prisma.board.create({
        data: {
          tenantId,
          projectId,
          name: dto.name,
          color: dto.color ?? '#5EEAD4',
          icon: dto.icon ?? null,
          description: dto.description ?? null,
          sequence: nextSequence,
          isDefault: false,
        },
      });
      const response = this.toResponse(created, 0);
      this.events.publishBoardCreated(response, tenantId);
      this.metrics?.incBoardCreated({
        tenantTop: tenantTopOf(tenantId),
        project: projectId,
      });
      return response;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'board_name_taken',
            message: 'Доска с таким именем уже существует в проекте',
          },
        });
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateBoardDto,
    tenantId: string,
    _userId: string,
  ): Promise<BoardResponseDto> {
    const existing = await this.requireBoard(id, tenantId);
    const changedFields: string[] = [];
    const data: Prisma.BoardUpdateInput = {};
    if (dto.name !== undefined && dto.name !== existing.name) {
      data.name = dto.name;
      changedFields.push('name');
    }
    if (dto.color !== undefined && dto.color !== existing.color) {
      data.color = dto.color;
      changedFields.push('color');
    }
    if (dto.icon !== undefined && dto.icon !== existing.icon) {
      data.icon = dto.icon;
      changedFields.push('icon');
    }
    if (dto.description !== undefined && dto.description !== existing.description) {
      data.description = dto.description;
      changedFields.push('description');
    }
    if (dto.sequence !== undefined && dto.sequence !== existing.sequence) {
      data.sequence = dto.sequence;
      changedFields.push('sequence');
    }
    if (changedFields.length === 0) {
      return this.findById(id, tenantId);
    }
    try {
      const updated = await this.prisma.board.update({ where: { id }, data });
      const count = await this.prisma.issue.count({
        where: { boardId: updated.id, deletedAt: null, archivedAt: null },
      });
      const response = this.toResponse(updated, count);
      this.events.publishBoardUpdated(response, tenantId, changedFields);
      return response;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'board_name_taken',
            message: 'Доска с таким именем уже существует в проекте',
          },
        });
      }
      throw e;
    }
  }

  async softDelete(
    id: string,
    tenantId: string,
    _userId: string,
  ): Promise<{ ok: true; movedIssuesCount: number; movedToBoardId: string }> {
    const existing = await this.requireBoard(id, tenantId);
    if (existing.isDefault) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'cannot_delete_default_board',
          message:
            'Нельзя удалить основную доску. Если нужно избавиться от неё — удалите проект целиком.',
        },
      });
    }
    const defaultBoardId = await this.ensureDefaultBoard({
      tenantId,
      projectId: existing.projectId,
    });
    if (defaultBoardId === existing.id) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'cannot_delete_default_board',
          message: 'Нельзя удалить единственную доску проекта',
        },
      });
    }
    const movedIssuesCount = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.issue.updateMany({
        where: { boardId: existing.id, tenantId },
        data: { boardId: defaultBoardId },
      });
      await tx.board.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      return moved.count;
    });
    this.events.publishBoardDeleted({
      tenantId,
      projectId: existing.projectId,
      boardId: existing.id,
      movedIssuesToBoardId: defaultBoardId,
      movedIssuesCount,
    });
    if (movedIssuesCount > 0) {
      this.metrics?.incBoardIssueMoved({
        tenantTop: tenantTopOf(tenantId),
        fromBoard: existing.id,
        toBoard: defaultBoardId,
      });
    }
    return { ok: true, movedIssuesCount, movedToBoardId: defaultBoardId };
  }

  async archive(id: string, tenantId: string, _userId: string): Promise<BoardResponseDto> {
    const existing = await this.requireBoard(id, tenantId);
    if (existing.isDefault) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'cannot_archive_default_board',
          message: 'Нельзя архивировать основную доску проекта',
        },
      });
    }
    if (existing.archivedAt) {
      return this.findById(id, tenantId);
    }
    const updated = await this.prisma.board.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    const count = await this.prisma.issue.count({
      where: { boardId: updated.id, deletedAt: null, archivedAt: null },
    });
    const response = this.toResponse(updated, count);
    this.events.publishBoardUpdated(response, tenantId, ['archivedAt']);
    this.metrics?.incBoardArchived({
      tenantTop: tenantTopOf(tenantId),
      project: existing.projectId,
    });
    return response;
  }

  async unarchive(id: string, tenantId: string, _userId: string): Promise<BoardResponseDto> {
    const existing = await this.requireBoard(id, tenantId);
    if (!existing.archivedAt) {
      return this.findById(id, tenantId);
    }
    const updated = await this.prisma.board.update({
      where: { id },
      data: { archivedAt: null },
    });
    const count = await this.prisma.issue.count({
      where: { boardId: updated.id, deletedAt: null, archivedAt: null },
    });
    const response = this.toResponse(updated, count);
    this.events.publishBoardUpdated(response, tenantId, ['archivedAt']);
    return response;
  }

  async reorder(
    boardIds: string[],
    tenantId: string,
    _userId: string,
  ): Promise<ListBoardsResponse> {
    if (boardIds.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'empty_board_ids',
          message: 'Список досок не может быть пустым',
        },
      });
    }
    const boards = await this.prisma.board.findMany({
      where: { id: { in: boardIds }, tenantId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (boards.length !== boardIds.length) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'board_not_found',
          message: 'Часть досок не найдена или не принадлежит организации',
        },
      });
    }
    const projectIds = new Set(boards.map((b) => b.projectId));
    if (projectIds.size > 1) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'boards_from_different_projects',
          message: 'Доски должны принадлежать одному проекту',
        },
      });
    }
    const projectId = boards[0]!.projectId;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Board"
        WHERE id = ANY(${boardIds}::text[])
          AND "tenantId" = ${tenantId}
          AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      for (let idx = 0; idx < boardIds.length; idx += 1) {
        const id = boardIds[idx]!;
        await tx.board.update({
          where: { id },
          data: { sequence: idx },
        });
      }
    });
    this.events.publishBoardReordered({ tenantId, projectId, boardIds });
    return this.findAll(projectId, tenantId, { includeArchived: false });
  }

  async requireBoard(id: string, tenantId: string): Promise<Board> {
    const b = await this.prisma.board.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!b) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'board_not_found', message: 'Доска не найдена' },
      });
    }
    return b;
  }

  async resolveDefaultBoardId(args: { tenantId: string; projectId: string }): Promise<string> {
    await this.projects.requireProject(args.projectId, args.tenantId);
    return this.ensureDefaultBoard(args);
  }

  async assertBoardInProject(args: {
    boardId: string;
    projectId: string;
    tenantId: string;
  }): Promise<void> {
    const b = await this.prisma.board.findFirst({
      where: {
        id: args.boardId,
        projectId: args.projectId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!b) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_board_id',
          message: 'Доска не найдена или принадлежит другому проекту',
        },
      });
    }
  }

  private toResponse(b: Board, issuesCount: number | null = null): BoardResponseDto {
    return {
      id: b.id,
      tenantId: b.tenantId,
      projectId: b.projectId,
      name: b.name,
      color: b.color,
      icon: b.icon,
      description: b.description,
      sequence: b.sequence,
      isDefault: b.isDefault,
      archivedAt: b.archivedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      deletedAt: b.deletedAt?.toISOString() ?? null,
      issuesCount,
    };
  }
}
