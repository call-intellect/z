import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  backfillGoalEmbeddings,
  type BackfillEmbeddings,
  type BackfillPrisma,
} from './backfill-goal-embeddings';

/**
 * Ф5 (TZ 2026-06-16) — idempotency-тест backfill-goal-embeddings.
 * Выборка строго по `embedding IS NULL` → повторный прогон = no-op.
 */
describe('backfillGoalEmbeddings', () => {
  let queryRawMock: ReturnType<typeof vi.fn>;
  let executeRawMock: ReturnType<typeof vi.fn>;
  let embedMock: ReturnType<typeof vi.fn>;
  let prisma: BackfillPrisma;
  let embeddings: BackfillEmbeddings;

  beforeEach(() => {
    queryRawMock = vi.fn();
    executeRawMock = vi.fn(async () => 1);
    embedMock = vi.fn(async () => [new Array(1536).fill(0.1)]);
    prisma = {
      $queryRawUnsafe: queryRawMock,
      $executeRawUnsafe: executeRawMock,
    } as unknown as BackfillPrisma;
    embeddings = { embed: embedMock } as unknown as BackfillEmbeddings;
  });

  it('первый прогон: цель без вектора → embed + UPDATE; запрос фильтрует embedding IS NULL', async () => {
    // Первый батч — 1 цель, второй — пусто (стоп).
    queryRawMock
      .mockResolvedValueOnce([
        { id: 'g1', tenantId: 't1', name: 'Цель', description: 'описание' },
      ])
      .mockResolvedValueOnce([]);

    const stats = await backfillGoalEmbeddings(prisma, embeddings, {
      dryRun: false,
    });

    expect(stats.embedded).toBe(1);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    // SELECT обязан фильтровать только не-посчитанные.
    expect(String(queryRawMock.mock.calls[0]?.[0])).toContain('"embedding" IS NULL');
    expect(String(executeRawMock.mock.calls[0]?.[0])).toContain('UPDATE "Goal"');
  });

  it('повтор = no-op: все цели уже с вектором → SELECT пуст → ни одного embed/UPDATE', async () => {
    queryRawMock.mockResolvedValueOnce([]); // нет целей без вектора

    const stats = await backfillGoalEmbeddings(prisma, embeddings, {
      dryRun: false,
    });

    expect(stats.scanned).toBe(0);
    expect(stats.embedded).toBe(0);
    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('dry-run: считает, но не пишет', async () => {
    queryRawMock
      .mockResolvedValueOnce([
        { id: 'g1', tenantId: 't1', name: 'Цель', description: null },
      ])
      .mockResolvedValueOnce([]);

    const stats = await backfillGoalEmbeddings(prisma, embeddings, {
      dryRun: true,
    });

    expect(stats.embedded).toBe(1);
    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });
});
