import { describe, expect, it, vi } from 'vitest';

import { ExecutablePersonaTriggerWatcherCron } from './executable-persona-trigger-watcher.cron';

/**
 * SBA γ-1 доделки — unit-тесты ExecutablePersonaTriggerWatcherCron.
 *
 * Покрывают:
 *   1. Skip: если нет ни одного snapshot — увеличиваем skippedNoSnapshotYet.
 *   2. Threshold: создан M ≥ thresholdTraitsCount новых traits → trigger.
 *   3. Critical: ≥1 trait misleading + severity=critical → trigger.
 *   4. Idempotency через VersioningService.locked → skippedLocked++.
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
    thresholdTraitsCount?: number;
  }): { cron: ExecutablePersonaTriggerWatcherCron; triggerRebuild: ReturnType<typeof vi.fn> } {
    const triggerRebuild = vi.fn(async (args: { profileId: string; reason: string }) =>
      opts.triggerRebuildImpl
        ? opts.triggerRebuildImpl(args)
        : { built: true, personaId: `p_${args.profileId}` },
    );
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
        findFirst: vi.fn(async ({ where }: { where: { profileId: string; status: string } }) => {
          if (where.status === 'misleading') {
            return opts.findCriticalMisleading(where.profileId);
          }
          return opts.findNewestTrait(where.profileId);
        }),
        count: vi.fn(async ({ where }: { where: { profileId: string } }) =>
          opts.newTraitsCount(where.profileId),
        ),
      },
    };
    const cfg = {
      persona: {
        thresholdTraitsCount: opts.thresholdTraitsCount ?? 3,
      },
    };
    const versioning = { triggerRebuild };
    const cron = new ExecutablePersonaTriggerWatcherCron(
      prisma as never,
      cfg as never,
      versioning as never,
    );
    return { cron, triggerRebuild };
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
    expect(r.triggeredThreshold).toBe(0);
    expect(triggerRebuild).not.toHaveBeenCalled();
  });

  it('critical: найден mark_as_misleading с [severity=critical] → trigger', async () => {
    const flaggedAt = new Date('2026-05-23T10:00:00Z');
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({ snapshotAt: new Date('2026-05-22T00:00:00Z') }),
      findCriticalMisleading: () => ({ id: 'tr1', misleadingFlaggedAt: flaggedAt }),
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

  it('threshold: ≥N новых traits → trigger', async () => {
    const newTraitCreated = new Date('2026-05-23T08:00:00Z');
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({ snapshotAt: new Date('2026-05-22T00:00:00Z') }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 5,
      findNewestTrait: () => ({ createdAt: newTraitCreated }),
      thresholdTraitsCount: 3,
    });
    const r = await cron.runOnce();
    expect(r.triggeredThreshold).toBe(1);
    expect(triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'p1', reason: 'threshold' }),
    );
  });

  it('locked: VersioningService возвращает built=false reason=locked → skippedLocked++', async () => {
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({ snapshotAt: new Date('2026-05-22T00:00:00Z') }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 5,
      findNewestTrait: () => ({ createdAt: new Date() }),
      triggerRebuildImpl: () => ({ built: false as const, reason: 'locked' }),
    });
    const r = await cron.runOnce();
    expect(r.skippedLocked).toBe(1);
    expect(r.triggeredThreshold).toBe(0);
    expect(triggerRebuild).toHaveBeenCalled();
  });

  it('skip: ниже threshold и без критических — skippedNoNewActivity++', async () => {
    const { cron, triggerRebuild } = makeCron({
      profiles: [{ id: 'p1', tenantId: 't1' }],
      findFirstLatest: () => ({ snapshotAt: new Date('2026-05-22T00:00:00Z') }),
      findCriticalMisleading: () => null,
      newTraitsCount: () => 1,
      findNewestTrait: () => null,
      thresholdTraitsCount: 3,
    });
    const r = await cron.runOnce();
    expect(r.skippedNoNewActivity).toBe(1);
    expect(triggerRebuild).not.toHaveBeenCalled();
  });
});
