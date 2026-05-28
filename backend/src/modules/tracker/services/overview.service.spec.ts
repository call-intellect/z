import type { Project } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { OverviewService } from './overview.service';
import type { ProjectsService } from './projects.service';

/**
 * Tracker Project Overview (2026-05-27) — unit-тесты `OverviewService`.
 *
 * Покрытие:
 *  - Кэширование: Redis-hit отдаёт пройдённую DTO без обращения к prisma.
 *  - Сборка из DB при cache-miss + write back в Redis.
 *  - Fallback при отсутствии модели `ProjectDocument` (parallel worktree).
 *  - Cache invalidation через @OnEvent (метод `onTrackerEvent`).
 *
 * ТЗ: plans/tz/2026-05-27-tracker-project-overview.md.
 */
describe('OverviewService', () => {
  const tenantId = 'org_1';
  const projectId = 'p1';

  const projectRow = {
    id: projectId,
    tenantId,
    slug: 'kora',
    identifier: 'KORA',
    name: 'Кора',
    description: 'Память компании',
    archivedAt: null,
    cycleViewEnabled: true,
    intakeViewEnabled: true,
    gantViewEnabled: false,
  };

  let prisma: PrismaService;
  let projects: ProjectsService;
  let redis: RedisService;
  let service: OverviewService;

  let redisGet: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;
  let redisDel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redisGet = vi.fn();
    redisSet = vi.fn().mockResolvedValue('OK');
    redisDel = vi.fn().mockResolvedValue(1);

    redis = {
      client: {
        get: redisGet,
        set: redisSet,
        del: redisDel,
      },
    } as unknown as RedisService;

    prisma = {
      project: {
        findFirstOrThrow: vi.fn().mockResolvedValue(projectRow),
      },
      projectMember: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', role: 20, joinedAt: new Date('2026-01-01') },
          { userId: 'u2', role: 15, joinedAt: new Date('2026-01-02') },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'u1', name: 'Иванов', email: 'i@a.ru' },
          { id: 'u2', name: 'Петров', email: 'p@a.ru' },
        ]),
      },
      issue: {
        count: vi
          .fn()
          .mockResolvedValueOnce(50) // total
          .mockResolvedValueOnce(8) // inProgress
          .mockResolvedValueOnce(2) // overdue
          .mockResolvedValueOnce(5), // completed7d
        findMany: vi.fn().mockResolvedValue([]),
      },
      cycle: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      issueActivity: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      goal: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;

    projects = {
      requireProject: vi
        .fn()
        .mockResolvedValue(projectRow as unknown as Project),
    } as unknown as ProjectsService;

    service = new OverviewService(prisma, projects, redis);
  });

  describe('getOverview', () => {
    it('возвращает агрегат и кэширует результат при cache-miss', async () => {
      redisGet.mockResolvedValue(null);

      const result = await service.getOverview({ projectId, tenantId });

      expect(projects.requireProject).toHaveBeenCalledWith(projectId, tenantId);
      expect(redisGet).toHaveBeenCalledWith(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
      );
      expect(result.project.id).toBe(projectId);
      expect(result.metrics).toEqual({
        totalIssues: 50,
        inProgressIssues: 8,
        overdueIssues: 2,
        completedLast7d: 5,
      });
      expect(result.members).toHaveLength(2);
      expect(result.recentDocuments).toEqual([]);

      // Кэш-write был.
      expect(redisSet).toHaveBeenCalledWith(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
        expect.any(String),
        'EX',
        OverviewService.CACHE_TTL_SECONDS,
      );
    });

    it('возвращает значение из Redis без обращения к DB при cache-hit', async () => {
      const cached = {
        project: { ...projectRow, archivedAt: null },
        members: [],
        metrics: {
          totalIssues: 999,
          inProgressIssues: 0,
          overdueIssues: 0,
          completedLast7d: 0,
        },
        statesDistribution: [],
        activeCycle: null,
        recentActivity: [],
        linkedGoals: [],
        recentDocuments: [],
      };
      redisGet.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getOverview({ projectId, tenantId });

      expect(result.metrics.totalIssues).toBe(999);
      // findFirstOrThrow на project не вызывался — пришло из кэша.
      expect(prisma.project.findFirstOrThrow).not.toHaveBeenCalled();
      expect(redisSet).not.toHaveBeenCalled();
    });

    it('не падает и отдаёт recentDocuments=[] когда модель ProjectDocument отсутствует', async () => {
      redisGet.mockResolvedValue(null);

      // В Prisma нет `projectDocument` (проверка `'projectDocument' in prisma`
      // должна вернуть false и пропустить запрос).
      const result = await service.getOverview({ projectId, tenantId });

      expect(result.recentDocuments).toEqual([]);
    });

    it('подхватывает recentDocuments если модель появилась', async () => {
      redisGet.mockResolvedValue(null);
      const docs = [
        {
          id: 'd1',
          title: 'Регламент',
          updatedAt: new Date('2026-05-26T10:00:00Z'),
        },
      ];
      (prisma as unknown as Record<string, unknown>).projectDocument = {
        findMany: vi.fn().mockResolvedValue(docs),
      };

      const result = await service.getOverview({ projectId, tenantId });

      expect(result.recentDocuments).toHaveLength(1);
      const [first] = result.recentDocuments;
      expect(first?.id).toBe('d1');
      expect(first?.title).toBe('Регламент');
    });
  });

  describe('invalidate', () => {
    it('делает DEL ключа кэша', async () => {
      await service.invalidate(projectId);
      expect(redisDel).toHaveBeenCalledWith(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
      );
    });

    it('не падает если Redis отсутствует', async () => {
      const svcNoRedis = new OverviewService(prisma, projects);
      await expect(svcNoRedis.invalidate(projectId)).resolves.toBeUndefined();
    });
  });

  describe('onTrackerEvent', () => {
    it('инвалидирует кэш проекта при event с issue.projectId', async () => {
      await service.onTrackerEvent({
        type: 'issue.created',
        issue: { projectId },
      });
      expect(redisDel).toHaveBeenCalledWith(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
      );
    });

    it('игнорирует event без issue.projectId', async () => {
      await service.onTrackerEvent({ type: 'unknown' });
      expect(redisDel).not.toHaveBeenCalled();
    });
  });
});
