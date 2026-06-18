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
    findFirstLatest: (
      profileId: string,
    ) =>
      | { snapshotAt: Date; status?: string; includedTraitIds?: string[] }
      | null;
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
    /** Б31 — текущие active SkillTrait.id по слою для computeCurrentInputTraitIds. */
    findManyTraitsByLayer?: (
      profileId: string,
      layer: string,
    ) => Array<{ id: string }>;
  }): {
    cron: ExecutablePersonaTriggerWatcherCron;
    triggerRebuild: ReturnType<typeof vi.fn>;
    incPersonaRebuildTriggered: ReturnType<typeof vi.fn>;
  } {
    const triggerRebuild = vi.fn(
      async (args: { profileId: string; reason: string }) =>
        opts.triggerRebuildImpl
          ? opts.triggerRebuildImpl(args)
          : { built: true, personaId: `p_${args.profileId}` },
    );
    const incPersonaRebuildTriggered = vi.fn();
    const prisma = {
      skillProfile: {
        findMany: vi.fn(async () => opts.profiles),
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
        // Б31 — computeCurrentInputTraitIds делает findMany по каждому layer.
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: { profileId: string; layer: string };
          }) =>
            opts.findManyTraitsByLayer
              ? opts.findManyTraitsByLayer(where.profileId, where.layer)
              : [],
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
    return { cron, triggerRebuild, incPersonaRebuildTriggered };
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

  it('Б31 max_age но тот же набор черт (includedTraitIds == текущие) → БЕЗ LLM-rebuild, skippedMaxAgeUnchanged++', async () => {
    const oldSnapshotAt = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50ч → max_age
    const { cron, triggerRebuild, incPersonaRebuildTriggered } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      // Активный snapshot с зафиксированным набором черт.
      findFirstLatest: () => ({
        snapshotAt: oldSnapshotAt,
        status: 'active',
        includedTraitIds: ['tr_skill_1', 'tr_skill_2', 'tr_value_1'],
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 0, // нет новых → trait_delta не сработает, идём в max_age
      findNewestTrait: () => null,
      // Текущий вход ИДЕНТИЧЕН includedTraitIds (порядок не важен — сравнение по множеству).
      findManyTraitsByLayer: (_p, layer) => {
        if (layer === 'skill') return [{ id: 'tr_skill_2' }, { id: 'tr_skill_1' }];
        if (layer === 'value') return [{ id: 'tr_value_1' }];
        return [];
      },
      maxAgeHours: 48,
    });
    const r = await cron.runOnce();
    // LLM-compile НЕ дёрнут — вход не изменился.
    expect(triggerRebuild).not.toHaveBeenCalled();
    expect(incPersonaRebuildTriggered).not.toHaveBeenCalled();
    expect(r.triggeredMaxAge).toBe(0);
    expect(r.skippedMaxAgeUnchanged).toBe(1);
  });

  it('Б31 max_age и набор черт ИЗМЕНИЛСЯ → rebuild как раньше', async () => {
    const oldSnapshotAt = new Date(Date.now() - 50 * 60 * 60 * 1000);
    const { cron, triggerRebuild, incPersonaRebuildTriggered } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({
        snapshotAt: oldSnapshotAt,
        status: 'active',
        includedTraitIds: ['tr_skill_1'],
      }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 0,
      findNewestTrait: () => null,
      // Текущий вход отличается (добавилась tr_skill_9).
      findManyTraitsByLayer: (_p, layer) =>
        layer === 'skill' ? [{ id: 'tr_skill_1' }, { id: 'tr_skill_9' }] : [],
      maxAgeHours: 48,
    });
    const r = await cron.runOnce();
    expect(r.triggeredMaxAge).toBe(1);
    expect(r.skippedMaxAgeUnchanged).toBe(0);
    expect(triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p1', reason: 'threshold' }),
    );
    expect(incPersonaRebuildTriggered).toHaveBeenCalledWith({ reason: 'max_age' });
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
