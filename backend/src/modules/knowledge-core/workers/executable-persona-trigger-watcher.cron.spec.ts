import { describe, expect, it, vi } from 'vitest';

import { ExecutablePersonaTriggerWatcherCron } from './executable-persona-trigger-watcher.cron';

/**
 * SBA γ-1 доделки + Фаза 5 «clone reliability hardening» —
 * unit-тесты ExecutablePersonaTriggerWatcherCron.
 *
 * Покрывают:
 *   1. Skip: если нет ни одного snapshot — увеличиваем skippedNoSnapshotYet.
 *   2. trait_delta: ≥ traitDeltaThreshold новых traits за 24ч → trigger,
 *      метрика persona_rebuild_triggered_total{reason=trait_delta}.
 *   3. max_age: age >= maxAgeHours без новых черт → trigger,
 *      метрика persona_rebuild_triggered_total{reason=max_age}.
 *   4. Оба условия не выполнены → нет rebuild.
 *   5. Critical: ≥1 trait misleading + severity=critical → trigger.
 *   6. Locked: VersioningService → skippedLocked++.
 */
describe('ExecutablePersonaTriggerWatcherCron.runOnce', () => {
  function makeCron(opts: {
    profiles: Array<{ id: string; tenantId: string }>;
    findFirstLatest: (profileId: string) => { snapshotAt: Date } | null;
    findCriticalMisleading: (
      profileId: string,
    ) => { id: string; misleadingFlaggedAt: Date } | null;
    newTraitsCount: (profileId: string) => number;
    findNewestTrait: (profileId: string) => { createdAt: Date } | null;
    triggerRebuildImpl?: (args: {
      profileId: string;
      reason: string;
    }) =>
      | { built: true; personaId: string }
      | { built: false; reason: string };
    traitDeltaThreshold?: number;
    maxAgeHours?: number;
  }): {
    cron: ExecutablePersonaTriggerWatcherCron;
    triggerRebuild: ReturnType<typeof vi.fn>;
    incPersonaRebuildTriggered: ReturnType<typeof vi.fn>;
    profileFindMany: ReturnType<typeof vi.fn>;
  } {
    const triggerRebuild = vi.fn(
      async (args: { profileId: string; reason: string }) =>
        opts.triggerRebuildImpl
          ? opts.triggerRebuildImpl(args)
          : { built: true, personaId: `p_${args.profileId}` },
    );
    const incPersonaRebuildTriggered = vi.fn();
    const profileFindMany = vi.fn(async () => opts.profiles);
    const prisma = {
      skillProfile: {
        findMany: profileFindMany,
      },
      executablePersona: {
        findFirst: vi.fn(async ({ where }: { where: { profileId: string } }) =>
          opts.findFirstLatest(where.profileId),
        ),
      },
      skillTrait: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { profileId: string; status: string };
          }) => {
            if (where.status === 'misleading') {
              return opts.findCriticalMisleading(where.profileId);
            }
            return opts.findNewestTrait(where.profileId);
          },
        ),
        count: vi.fn(async ({ where }: { where: { profileId: string } }) =>
          opts.newTraitsCount(where.profileId),
        ),
      },
    };
    const cfg = {
      skill: {
        personaRebuildTraitDeltaThreshold: opts.traitDeltaThreshold ?? 2,
        personaRebuildMaxAgeHours: opts.maxAgeHours ?? 48,
      },
    };
    const versioning = { triggerRebuild };
    const metrics = { incPersonaRebuildTriggered };
    const cron = new ExecutablePersonaTriggerWatcherCron(
      prisma as never,
      cfg as never,
      versioning as never,
      metrics as never,
    );
    return { cron, triggerRebuild, incPersonaRebuildTriggered, profileFindMany };
  }

  it('skip: нет snapshot ещё → skippedNoSnapshotYet++', async () => {
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => null,
      findCriticalMisleading: () => null,
      newTraitsCount: () => 10,
      findNewestTrait: () => null,
    });
    const r = await cron.runOnce();
    expect(r.skippedNoSnapshotYet).toBe(1);
    expect(r.triggeredTraitDelta).toBe(0);
    expect(r.triggeredMaxAge).toBe(0);
    expect(triggerRebuild).not.toHaveBeenCalled();
  });

  it('critical: найден mark_as_misleading с [severity=critical] → trigger', async () => {
    const flaggedAt = new Date(Date.now() - 60 * 60 * 1000); // 1ч назад
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({
        snapshotAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6ч назад
      }),
      findCriticalMisleading: () => ({
        id: 'tr1',
        misleadingFlaggedAt: flaggedAt,
      }),
      newTraitsCount: () => 0,
      findNewestTrait: () => null,
    });
    const r = await cron.runOnce();
    expect(r.triggeredCritical).toBe(1);
    expect(triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'p1',
        reason: 'critical',
        triggerEventAt: flaggedAt,
      }),
    );
  });

  it('trait_delta: ≥2 новых traits за 24ч → trigger + метрика', async () => {
    const newTraitCreated = new Date(Date.now() - 60 * 60 * 1000); // 1ч назад
    const { cron, triggerRebuild, incPersonaRebuildTriggered } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      // snapshot свежий (6ч назад) — max_age НЕ сработает
      findFirstLatest: () => ({
        snapshotAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 2,
      findNewestTrait: () => ({ createdAt: newTraitCreated }),
      traitDeltaThreshold: 2,
      maxAgeHours: 48,
    });
    const r = await cron.runOnce();
    expect(r.triggeredTraitDelta).toBe(1);
    expect(r.triggeredMaxAge).toBe(0);
    expect(triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p1', reason: 'threshold' }),
    );
    expect(incPersonaRebuildTriggered).toHaveBeenCalledWith({
      reason: 'trait_delta',
    });
  });

  it('max_age: age >= 48ч без новых черт → trigger + метрика max_age', async () => {
    const oldSnapshotAt = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50ч назад
    const { cron, triggerRebuild, incPersonaRebuildTriggered } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({ snapshotAt: oldSnapshotAt }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 0, // нет новых черт → trait_delta не сработает
      findNewestTrait: () => null,
      traitDeltaThreshold: 2,
      maxAgeHours: 48,
    });
    const r = await cron.runOnce();
    expect(r.triggeredMaxAge).toBe(1);
    expect(r.triggeredTraitDelta).toBe(0);
    expect(triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p1', reason: 'threshold' }),
    );
    expect(incPersonaRebuildTriggered).toHaveBeenCalledWith({
      reason: 'max_age',
    });
  });

  it('skip: оба условия не выполнены → нет rebuild, skippedNoNewActivity++', async () => {
    const { cron, triggerRebuild, incPersonaRebuildTriggered } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      // snapshot свежий (6ч назад), age < 48ч
      findFirstLatest: () => ({
        snapshotAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 1, // < threshold(2)
      findNewestTrait: () => null,
      traitDeltaThreshold: 2,
      maxAgeHours: 48,
    });
    const r = await cron.runOnce();
    expect(r.skippedNoNewActivity).toBe(1);
    expect(r.triggeredTraitDelta).toBe(0);
    expect(r.triggeredMaxAge).toBe(0);
    expect(triggerRebuild).not.toHaveBeenCalled();
    expect(incPersonaRebuildTriggered).not.toHaveBeenCalled();
  });

  it('Б14: профили выбираются с orderBy lastBuildAt asc nulls first + id asc (не scan-order)', async () => {
    const { cron, profileFindMany } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({
        snapshotAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 0,
      findNewestTrait: () => null,
    });
    await cron.runOnce();
    const arg = profileFindMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(arg.orderBy).toEqual([
      { lastBuildAt: { sort: 'asc', nulls: 'first' } },
      { id: 'asc' },
    ]);
  });

  it('locked: VersioningService возвращает built=false reason=locked → skippedLocked++', async () => {
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({
        snapshotAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 5,
      findNewestTrait: () => ({ createdAt: new Date() }),
      triggerRebuildImpl: () => ({ built: false as const, reason: 'locked' }),
      traitDeltaThreshold: 2,
    });
    const r = await cron.runOnce();
    expect(r.skippedLocked).toBe(1);
    expect(r.triggeredTraitDelta).toBe(0);
    expect(triggerRebuild).toHaveBeenCalled();
  });
});
