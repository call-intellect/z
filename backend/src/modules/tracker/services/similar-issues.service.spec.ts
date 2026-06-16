import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { SimilarIssuesService } from './similar-issues.service';

/**
 * Юнит-тест SimilarIssuesService — мок `$queryRawUnsafe`, проверка фильтра
 * по threshold и метрики.
 */
describe('SimilarIssuesService.findSimilar', () => {
  let prisma: PrismaService;
  let metrics: BusinessMetricsService;
  let svc: SimilarIssuesService;
  let queryRawMock: ReturnType<typeof vi.fn>;
  let incSimilarSearchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryRawMock = vi.fn();
    prisma = { $queryRawUnsafe: queryRawMock } as unknown as PrismaService;
    incSimilarSearchMock = vi.fn();
    metrics = {
      incTrackerIssueSimilarSearch: incSimilarSearchMock,
    } as unknown as BusinessMetricsService;
    svc = new SimilarIssuesService(prisma, metrics);
  });

  it('у исходной задачи нет embedding → empty result, метрика инкремент', async () => {
    queryRawMock.mockResolvedValueOnce([{ embedding: null }]);
    const result = await svc.findSimilar({ tenantId: 't1', issueId: 'iss1' });
    expect(result).toEqual([]);
    expect(queryRawMock).toHaveBeenCalledTimes(1); // только seed
    expect(incSimilarSearchMock).toHaveBeenCalledTimes(1);
  });

  it('исходная задача не существует → empty result', async () => {
    queryRawMock.mockResolvedValueOnce([]);
    const result = await svc.findSimilar({ tenantId: 't1', issueId: 'lost' });
    expect(result).toEqual([]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('фильтр по threshold: distance > threshold отбрасывается', async () => {
    queryRawMock.mockResolvedValueOnce([
      { embedding: '[0.1,0.2,0.3]' },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        id: 'iss2',
        identifier: 'K-2',
        title: 'Near',
        stateId: 'st1',
        projectId: 'p1',
        completedAt: null,
        distance: 0.05, // < 0.18 → попадает
      },
      {
        id: 'iss3',
        identifier: 'K-3',
        title: 'Far',
        stateId: 'st1',
        projectId: 'p1',
        completedAt: null,
        distance: 0.5, // > 0.18 → отброшен
      },
    ]);

    const result = await svc.findSimilar({
      tenantId: 't1',
      issueId: 'iss1',
      threshold: 0.18,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('iss2');
    expect(result[0]?.similarity).toBeCloseTo(0.95, 5); // 1 - 0.05
  });

  it('completedAt преобразуется в ISO-строку', async () => {
    queryRawMock.mockResolvedValueOnce([{ embedding: '[0,0,1]' }]);
    queryRawMock.mockResolvedValueOnce([
      {
        id: 'iss2',
        identifier: 'K-2',
        title: 'Done one',
        stateId: 'st_done',
        projectId: 'p1',
        completedAt: new Date('2026-05-01T10:00:00Z'),
        distance: 0.1,
      },
    ]);

    const result = await svc.findSimilar({ tenantId: 't1', issueId: 'iss1' });

    expect(result).toHaveLength(1);
    expect(result[0]?.completedAt).toBe('2026-05-01T10:00:00.000Z');
  });

  it('limit ограничивается MAX_LIMIT=20', async () => {
    queryRawMock.mockResolvedValueOnce([{ embedding: '[1,2,3]' }]);
    queryRawMock.mockResolvedValueOnce([]);

    await svc.findSimilar({
      tenantId: 't1',
      issueId: 'iss1',
      limit: 9999,
    });

    // Второй вызов — это KNN. Аргумент $4 — limit*2; при clamp limit=20 → 40.
    const knnCall = queryRawMock.mock.calls[1];
    expect(knnCall).toBeDefined();
    if (!knnCall) throw new Error('unreachable');
    expect(knnCall[4]).toBe(40);
  });

  it('similarity clamp в [0, 1]: floating-point distance > 1 → 0', async () => {
    queryRawMock.mockResolvedValueOnce([{ embedding: '[0,0,0]' }]);
    queryRawMock.mockResolvedValueOnce([
      {
        id: 'iss2',
        identifier: 'K-2',
        title: 'Edge',
        stateId: null,
        projectId: 'p1',
        completedAt: null,
        distance: -0.0000001, // 1 - (-0.0000001) = 1.0000001 → clamp 1
      },
    ]);

    const result = await svc.findSimilar({ tenantId: 't1', issueId: 'iss1' });

    expect(result).toHaveLength(1);
    expect(result[0]?.similarity).toBe(1);
  });

  it('метрика incTrackerIssueSimilarSearch вызывается всегда (даже при empty result)', async () => {
    queryRawMock.mockResolvedValueOnce([{ embedding: null }]);
    await svc.findSimilar({ tenantId: 't1', issueId: 'iss1' });
    expect(incSimilarSearchMock).toHaveBeenCalledTimes(1);
    expect(incSimilarSearchMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
    });
  });
});

/**
 * TZ task-dedup (2026-06-16, Ф1) — findSimilarByVector: KNN по готовому вектору
 * (без seed-задачи), фильтр openOnly, исключение задачи.
 */
describe('SimilarIssuesService.findSimilarByVector', () => {
  let prisma: PrismaService;
  let metrics: BusinessMetricsService;
  let svc: SimilarIssuesService;
  let queryRawMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryRawMock = vi.fn();
    prisma = { $queryRawUnsafe: queryRawMock } as unknown as PrismaService;
    metrics = {
      incTrackerIssueSimilarSearch: vi.fn(),
    } as unknown as BusinessMetricsService;
    svc = new SimilarIssuesService(prisma, metrics);
  });

  it('по вектору сразу делает KNN (без seed-запроса) и фильтрует по threshold', async () => {
    queryRawMock.mockResolvedValueOnce([
      {
        id: 'iss2',
        identifier: 'K-2',
        title: 'Похожая',
        stateId: 'st1',
        projectId: 'p1',
        completedAt: null,
        distance: 0.04, // < 0.18 → попадает
      },
      {
        id: 'iss3',
        identifier: 'K-3',
        title: 'Далёкая',
        stateId: 'st1',
        projectId: 'p1',
        completedAt: null,
        distance: 0.9, // > 0.18 → отброшена
      },
    ]);

    const result = await svc.findSimilarByVector({
      tenantId: 't1',
      embedding: '[0.1,0.2,0.3]',
      threshold: 0.18,
    });

    expect(queryRawMock).toHaveBeenCalledTimes(1); // нет seed-запроса
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('iss2');
    expect(result[0]?.similarity).toBeCloseTo(0.96, 5);
  });

  it('openOnly=true добавляет фильтр completedAt IS NULL в SQL', async () => {
    queryRawMock.mockResolvedValueOnce([]);
    await svc.findSimilarByVector({
      tenantId: 't1',
      embedding: '[1,0,0]',
      openOnly: true,
    });
    const sql = queryRawMock.mock.calls[0]?.[0] as string;
    expect(sql).toContain('"completedAt" IS NULL');
  });

  it('openOnly не задан → нет фильтра completedAt IS NULL', async () => {
    queryRawMock.mockResolvedValueOnce([]);
    await svc.findSimilarByVector({
      tenantId: 't1',
      embedding: '[1,0,0]',
    });
    const sql = queryRawMock.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('"completedAt" IS NULL');
  });

  it('excludeIssueId добавляет условие id <> $N с правильным параметром', async () => {
    queryRawMock.mockResolvedValueOnce([]);
    await svc.findSimilarByVector({
      tenantId: 't1',
      embedding: '[1,0,0]',
      excludeIssueId: 'self-id',
    });
    const call = queryRawMock.mock.calls[0]!;
    const sql = call[0] as string;
    expect(sql).toContain('id <> $3');
    // params: $1 embedding, $2 tenantId, $3 excludeIssueId, $4 limit
    expect(call[3]).toBe('self-id');
  });
});
