import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Board } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { BoardsService } from './boards.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEventsService } from './tracker-events.service';

/**
 * Tracker Boards (2026-05-27) — unit-тесты `BoardsService`.
 *
 * Покрытие:
 *   - `create` — успешный путь + 409 на дубликат имени.
 *   - `softDelete` — перенос issues на default + защита от удаления default.
 *   - `archive` — защита от архивации default.
 *
 * Интеграционные сценарии (реальная Prisma, RBAC) — отдельный *.integration.spec.ts,
 * прогоняется на dev-DB после merge.
 *
 * ТЗ: plans/tz/2026-05-27-tracker-boards.md.
 */
describe('BoardsService', () => {
  const tenantId = 'org_1';
  const projectId = 'p1';
  const defaultBoardId = 'b_default';
  const customBoardId = 'b_marketing';
  const otherCustomBoardId = 'b_design';

  const defaultBoardRow: Board = {
    id: defaultBoardId,
    tenantId,
    projectId,
    name: 'Доска',
    color: '#5EEAD4',
    icon: null,
    description: null,
    sequence: 0,
    isDefault: true,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  };

  const customBoardRow: Board = {
    ...defaultBoardRow,
    id: customBoardId,
    name: 'Доска маркетинга',
    sequence: 1,
    isDefault: false,
  };

  let prisma: PrismaService;
  let projects: ProjectsService;
  let events: TrackerEventsService;
  let service: BoardsService;

  let boardFindFirst: ReturnType<typeof vi.fn>;
  let boardCreate: ReturnType<typeof vi.fn>;
  let boardUpdate: ReturnType<typeof vi.fn>;
  let boardAggregate: ReturnType<typeof vi.fn>;
  let issueCount: ReturnType<typeof vi.fn>;
  let issueUpdateMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    boardFindFirst = vi.fn();
    boardCreate = vi.fn();
    boardUpdate = vi.fn();
    boardAggregate = vi.fn();
    issueCount = vi.fn().mockResolvedValue(0);
    issueUpdateMany = vi.fn();

    type TxArg = {
      board: { update: typeof boardUpdate };
      issue: { updateMany: typeof issueUpdateMany };
    };

    prisma = {
      board: {
        findFirst: boardFindFirst,
        create: boardCreate,
        update: boardUpdate,
        aggregate: boardAggregate,
      },
      issue: {
        count: issueCount,
        groupBy: vi.fn().mockResolvedValue([]),
      },
      $transaction: async (fn: (tx: TxArg) => unknown) =>
        fn({
          board: { update: boardUpdate },
          issue: { updateMany: issueUpdateMany },
        }),
    } as unknown as PrismaService;

    projects = {
      requireProject: vi.fn().mockResolvedValue({ id: projectId, tenantId }),
    } as unknown as ProjectsService;

    events = {
      publishBoardCreated: vi.fn(),
      publishBoardUpdated: vi.fn(),
      publishBoardDeleted: vi.fn(),
      publishBoardReordered: vi.fn(),
    } as unknown as TrackerEventsService;

    service = new BoardsService(prisma, projects, events);
  });

  describe('create', () => {
    it('создаёт доску с следующим sequence', async () => {
      boardAggregate.mockResolvedValue({ _max: { sequence: 0 } });
      boardCreate.mockResolvedValue({ ...customBoardRow, sequence: 1 });

      const result = await service.create(
        projectId,
        { name: 'Доска маркетинга', color: '#FF00AA' },
        tenantId,
        'u1',
      );

      expect(projects.requireProject).toHaveBeenCalledWith(projectId, tenantId);
      expect(boardCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            projectId,
            name: 'Доска маркетинга',
            color: '#FF00AA',
            sequence: 1,
            isDefault: false,
          }),
        }),
      );
      expect(result.name).toBe('Доска маркетинга');
      expect(result.isDefault).toBe(false);
      expect(events.publishBoardCreated).toHaveBeenCalledTimes(1);
    });

    it('кидает 409 на дубликат имени', async () => {
      boardAggregate.mockResolvedValue({ _max: { sequence: 0 } });
      // Эмулируем Prisma unique-constraint violation.
      const err = new Error('Unique violation') as Error & {
        code: string;
        clientVersion: string;
      };
      err.code = 'P2002';
      err.clientVersion = '7.0.0';
      Object.setPrototypeOf(
        err,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype,
      );
      boardCreate.mockRejectedValue(err);

      await expect(
        service.create(
          projectId,
          { name: 'Доска' },
          tenantId,
          'u1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('softDelete', () => {
    it('переносит issues на default-доску и помечает доску deletedAt', async () => {
      boardFindFirst
        // requireBoard
        .mockResolvedValueOnce(customBoardRow)
        // ensureDefaultBoard — нашли default
        .mockResolvedValueOnce({ id: defaultBoardId });
      issueUpdateMany.mockResolvedValue({ count: 7 });
      boardUpdate.mockResolvedValue({ ...customBoardRow, deletedAt: new Date() });

      const result = await service.softDelete(customBoardId, tenantId, 'u1');

      expect(issueUpdateMany).toHaveBeenCalledWith({
        where: { boardId: customBoardId, tenantId },
        data: { boardId: defaultBoardId },
      });
      expect(boardUpdate).toHaveBeenCalledWith({
        where: { id: customBoardId },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
      expect(result.movedIssuesCount).toBe(7);
      expect(result.movedToBoardId).toBe(defaultBoardId);
      expect(events.publishBoardDeleted).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          projectId,
          boardId: customBoardId,
          movedIssuesToBoardId: defaultBoardId,
          movedIssuesCount: 7,
        }),
      );
    });

    it('запрещает удаление default-доски (409)', async () => {
      boardFindFirst.mockResolvedValueOnce(defaultBoardRow);

      await expect(
        service.softDelete(defaultBoardId, tenantId, 'u1'),
      ).rejects.toThrow(ConflictException);
      // Не должны были даже попытаться перенести issues.
      expect(issueUpdateMany).not.toHaveBeenCalled();
    });

    it('кидает 404 если доска не найдена', async () => {
      boardFindFirst.mockResolvedValueOnce(null);

      await expect(
        service.softDelete('b_missing', tenantId, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('запрещает архивацию default-доски (409)', async () => {
      boardFindFirst.mockResolvedValueOnce(defaultBoardRow);
      await expect(
        service.archive(defaultBoardId, tenantId, 'u1'),
      ).rejects.toThrow(ConflictException);
    });

    it('архивирует обычную доску', async () => {
      const now = new Date();
      boardFindFirst
        .mockResolvedValueOnce(customBoardRow)
        .mockResolvedValueOnce({ ...customBoardRow, archivedAt: now });
      boardUpdate.mockResolvedValue({ ...customBoardRow, archivedAt: now });

      const result = await service.archive(customBoardId, tenantId, 'u1');

      expect(boardUpdate).toHaveBeenCalledWith({
        where: { id: customBoardId },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      });
      expect(result.archivedAt).not.toBeNull();
      expect(events.publishBoardUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: customBoardId }),
        tenantId,
        ['archivedAt'],
      );
    });
  });

  describe('ensureDefaultBoard', () => {
    it('возвращает существующий default без создания', async () => {
      boardFindFirst.mockResolvedValueOnce({ id: defaultBoardId });

      const id = await service.ensureDefaultBoard({ tenantId, projectId });

      expect(id).toBe(defaultBoardId);
      expect(boardCreate).not.toHaveBeenCalled();
    });

    it('создаёт default-доску если её нет', async () => {
      boardFindFirst.mockResolvedValueOnce(null);
      boardCreate.mockResolvedValue({ id: 'b_new' });

      const id = await service.ensureDefaultBoard({ tenantId, projectId });

      expect(id).toBe('b_new');
      expect(boardCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          projectId,
          name: 'Доска',
          isDefault: true,
          sequence: 0,
        }),
        select: { id: true },
      });
    });
  });

  describe('reorder', () => {
    it('переустанавливает sequence в порядке передачи', async () => {
      // Все доски одного проекта.
      const findManyMock = vi.fn().mockResolvedValue([
        { id: customBoardId, projectId },
        { id: otherCustomBoardId, projectId },
      ]);
      (prisma as unknown as { board: { findMany: typeof findManyMock } }).board.findMany =
        findManyMock;
      // findAll вызывается на финале — мокаем чтобы не падал.
      (prisma as unknown as {
        board: { findMany: typeof findManyMock };
      }).board.findMany = vi
        .fn()
        // первый вызов — для валидации boardIds (нужен projectId на каждой)
        .mockResolvedValueOnce([
          { id: customBoardId, projectId },
          { id: otherCustomBoardId, projectId },
        ])
        // второй вызов — внутри findAll
        .mockResolvedValueOnce([customBoardRow]);

      // $transaction принимает массив update-промисов; в нашем mock'е prisma
      // транзакция уже определена как функция-callback. Заменим, чтобы
      // принимать массив.
      (prisma as unknown as {
        $transaction: (
          arg: unknown,
        ) => Promise<unknown>;
      }).$transaction = vi.fn().mockResolvedValue([]);

      boardUpdate.mockResolvedValue(customBoardRow);

      const result = await service.reorder(
        [otherCustomBoardId, customBoardId],
        tenantId,
        'u1',
      );

      expect(events.publishBoardReordered).toHaveBeenCalledWith({
        tenantId,
        projectId,
        boardIds: [otherCustomBoardId, customBoardId],
      });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });
});
