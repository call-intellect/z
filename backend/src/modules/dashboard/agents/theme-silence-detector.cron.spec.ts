import { describe, expect, it, vi } from 'vitest';

import { ThemeSilenceDetectorCron } from './theme-silence-detector.cron';

/**
 * Редизайн кабинета Ф8.2 🔴 — unit-тесты ThemeSilenceDetectorCron.
 *
 * Mock Prisma/cfg/metrics, детерминизм времени через аргумент `now`. Покрываем:
 *   1. тема с lastSignalAt 4 недели назад → Insight создан (kind='risk');
 *   2. свежая тема (сигнал на этой неделе) → Insight НЕ создаётся;
 *   3. повтор: silence-Insight уже есть → update, без дубля (surfaced=0);
 *   4. авто-разрешение: тема ожила → старый silence-Insight → mitigated;
 *   5. severity по давности (medium/high/critical).
 */
describe('ThemeSilenceDetectorCron', () => {
  const now = new Date('2026-06-13T10:00:00.000Z');

  function buildCfg(weeks = 3) {
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) => {
        if (key === 'dashboard.theme_silence.enabled') return true;
        if (key === 'dashboard.theme_silence_weeks') return weeks;
        return def;
      }),
    };
  }

  function build(opts: {
    themes?: Array<{ id: string; name: string; lastSignalAt: Date | null }>;
    /** Существующие активные silence-Insight'ы (causeCategory='ts:<id>'). */
    existingInsights?: Array<{ id: string; causeCategory: string; status: string }>;
    weeks?: number;
  }) {
    const created: Array<Record<string, unknown>> = [];
    const updated: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue([{ id: 't1' }]),
      },
      theme: {
        findMany: vi.fn().mockResolvedValue(opts.themes ?? []),
      },
      insight: {
        // findFirst — поиск silence-Insight по точному causeCategory.
        findFirst: vi.fn(async (arg: { where: { causeCategory: string } }) => {
          const found = (opts.existingInsights ?? []).find(
            (i) => i.causeCategory === arg.where.causeCategory,
          );
          return found ? { id: found.id, status: found.status } : null;
        }),
        // findMany — активные silence-Insight'ы (startsWith 'ts:') для авто-резолва.
        findMany: vi.fn(async () =>
          (opts.existingInsights ?? [])
            .filter((i) => i.status === 'active')
            .map((i) => ({ id: i.id, causeCategory: i.causeCategory })),
        ),
        create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
          created.push(arg.data);
          return { id: `ins-${created.length}` };
        }),
        update: vi.fn(async (arg: { where: { id: string }; data: Record<string, unknown> }) => {
          updated.push(arg);
          return { id: arg.where.id };
        }),
      },
    };
    const metrics = { incThemeSilenceSurfaced: vi.fn() };
    const cron = new ThemeSilenceDetectorCron(
      prisma as never,
      buildCfg(opts.weeks ?? 3) as never,
      metrics as never,
    );
    return { cron, prisma, metrics, created, updated };
  }

  const weeksAgo = (n: number): Date =>
    new Date(now.getTime() - n * 7 * 24 * 3_600_000);

  it('тема молчит 4 недели → Insight создан (kind=risk)', async () => {
    const { cron, metrics, created } = build({
      themes: [{ id: 'th1', name: 'Биллинг', lastSignalAt: weeksAgo(4) }],
    });
    const res = await cron.runOnce(now);
    expect(res.surfaced).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe('risk');
    expect(created[0]!.causeCategory).toBe('ts:th1');
    expect(String(created[0]!.statement)).toContain('Биллинг');
    expect(metrics.incThemeSilenceSurfaced).toHaveBeenCalledWith({
      severity: 'medium',
    });
  });

  it('свежая тема (сигнал на этой неделе) → Insight НЕ создаётся', async () => {
    // findMany уже отфильтровал бы по cutoff в реальном Prisma; здесь подаём
    // пустой список «молчащих», что эквивалентно «тема свежая».
    const { cron, created } = build({ themes: [] });
    const res = await cron.runOnce(now);
    expect(res.surfaced).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('повтор: silence-Insight уже есть → update, без дубля (surfaced=0)', async () => {
    const { cron, created, updated } = build({
      themes: [{ id: 'th1', name: 'Биллинг', lastSignalAt: weeksAgo(5) }],
      existingInsights: [
        { id: 'ins-old', causeCategory: 'ts:th1', status: 'active' },
      ],
    });
    const res = await cron.runOnce(now);
    expect(res.surfaced).toBe(0);
    expect(created).toHaveLength(0);
    // Обновили существующий (lastObservedAt/severity/statement).
    const upd = updated.find((u) => u.where.id === 'ins-old');
    expect(upd).toBeDefined();
    expect(upd!.data.status).toBe('active');
  });

  it('авто-разрешение: тема ожила → старый silence-Insight → mitigated', async () => {
    // Тема th1 больше НЕ молчит (нет в themes), но активный silence-Insight есть.
    const { cron, updated } = build({
      themes: [], // ни одной молчащей темы
      existingInsights: [
        { id: 'ins-th1', causeCategory: 'ts:th1', status: 'active' },
      ],
    });
    const res = await cron.runOnce(now);
    expect(res.resolved).toBe(1);
    const upd = updated.find((u) => u.where.id === 'ins-th1');
    expect(upd).toBeDefined();
    expect(upd!.data.status).toBe('mitigated');
  });

  it('severity растёт с давностью: 7 нед → high, 13 нед → critical', async () => {
    const high = build({
      themes: [{ id: 'th-h', name: 'Тема H', lastSignalAt: weeksAgo(7) }],
    });
    await high.cron.runOnce(now);
    expect(high.metrics.incThemeSilenceSurfaced).toHaveBeenCalledWith({
      severity: 'high',
    });

    const crit = build({
      themes: [{ id: 'th-c', name: 'Тема C', lastSignalAt: weeksAgo(13) }],
    });
    await crit.cron.runOnce(now);
    expect(crit.metrics.incThemeSilenceSurfaced).toHaveBeenCalledWith({
      severity: 'critical',
    });
  });
});
