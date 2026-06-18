import { describe, expect, it, vi } from 'vitest';

import { EntityGraphService } from './entity-graph.service';

/**
 * Б30 [K6] — findCoMentionedPairs исключает пары, у которых уже есть свежий
 * (updatedAt > now-Nдней, не soft-deleted) EntityLink. Без этого cron ежечасно
 * re-LLM'ит топ-50 пар даже при существующей связи (~1200 вызовов/сутки/Org).
 *
 * SQL — raw, поэтому проверяем: (1) в запросе появился NOT EXISTS по EntityLink
 * с фильтром по updatedAt; (2) 4-м параметром передаётся cutoff-дата (now-Nдней).
 */
describe('EntityGraphService.findCoMentionedPairs — исключение свежих EntityLink (Б30 [K6])', () => {
  function makeService(queryRawUnsafe: ReturnType<typeof vi.fn>) {
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      entity: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return new EntityGraphService(
      prisma as never,
      {} as never, // llm — не нужен для выборки пар
      undefined,
      undefined,
    );
  }

  it('SQL содержит NOT EXISTS по EntityLink с фильтром updatedAt + cutoff-дата как $4', async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const svc = makeService(queryRawUnsafe);

    const before = Date.now();
    await svc.findCoMentionedPairs({
      tenantId: 'org-1',
      minComentions: 2,
      limit: 50,
    });
    const after = Date.now();

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const call = queryRawUnsafe.mock.calls[0] as unknown[];
    const sql = String(call[0]);

    // (1) Подзапрос-исключение по существующему свежему ребру.
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('"EntityLink"');
    expect(sql).toMatch(/el\."updatedAt"\s*>\s*\$4/);
    // Soft-deleted рёбра не считаются «свежими».
    expect(sql).toContain('el."deletedAt" IS NULL');

    // (2) Параметры: $1 tenantId, $2 minComentions, $3 limit, $4 cutoff-дата.
    expect(call[1]).toBe('org-1');
    expect(call[2]).toBe(2);
    expect(call[3]).toBe(50);
    const cutoff = call[4] as Date;
    expect(cutoff).toBeInstanceOf(Date);
    // Cutoff = now - 30 дней (±окно вызова).
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs - 5000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs + 5000);
  });
});
