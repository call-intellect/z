import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, runBackfillSkillProfilesRebuild } from './backfill-skill-profiles-rebuild';

describe('backfill-skill-profiles-rebuild parseArgs — обе формы --tenant', () => {
  it('--tenant=<id> (форма с =)', () => {
    expect(parseArgs(['--tenant=org-7']).tenantId).toBe('org-7');
  });

  it('--tenant <id> (форма через пробел) — НЕ молчаливый all-Org', () => {
    expect(parseArgs(['--tenant', 'org-7']).tenantId).toBe('org-7');
  });

  it('без флага → tenantId undefined (все Org), dryRun по --dry-run', () => {
    const a = parseArgs(['--dry-run']);
    expect(a.tenantId).toBeUndefined();
    expect(a.dryRun).toBe(true);
  });

  it('--tenant без значения (следом другой флаг) → не подхватывает флаг как id', () => {
    expect(parseArgs(['--tenant', '--dry-run']).tenantId).toBeUndefined();
  });
});

describe('runBackfillSkillProfilesRebuild', () => {
  let findMany: ReturnType<typeof vi.fn>;
  let enqueueRebuildSkillProfile: ReturnType<typeof vi.fn>;
  let prisma: { skillProfile: { findMany: ReturnType<typeof vi.fn> } };
  let coreQueue: { enqueueRebuildSkillProfile: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    findMany = vi.fn();
    enqueueRebuildSkillProfile = vi.fn();
    prisma = { skillProfile: { findMany } };
    coreQueue = { enqueueRebuildSkillProfile };
  });

  it('2 active-профиля → 2 enqueue с верными args', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'p1', tenantId: 'org-1' },
      { id: 'p2', tenantId: 'org-1' },
    ]);
    enqueueRebuildSkillProfile.mockResolvedValue({ jobId: 'x' });

    const stats = await runBackfillSkillProfilesRebuild(prisma as never, coreQueue, {
      dryRun: false,
    });

    expect(stats.total).toBe(2);
    expect(stats.enqueued).toBe(2);
    expect(enqueueRebuildSkillProfile).toHaveBeenCalledTimes(2);
    expect(enqueueRebuildSkillProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'p1',
        tenantId: 'org-1',
        reason: 'backfill-methodology-step',
        delayMs: 0,
      }),
    );
  });

  it('dry-run → 0 enqueue', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'p1', tenantId: 'org-1' },
      { id: 'p2', tenantId: 'org-1' },
    ]);

    const stats = await runBackfillSkillProfilesRebuild(prisma as never, coreQueue, {
      dryRun: true,
    });

    expect(stats.total).toBe(2);
    expect(enqueueRebuildSkillProfile).not.toHaveBeenCalled();
  });

  it('0 профилей → 0 enqueue', async () => {
    findMany.mockResolvedValueOnce([]);

    const stats = await runBackfillSkillProfilesRebuild(prisma as never, coreQueue, {
      dryRun: false,
    });

    expect(stats.total).toBe(0);
    expect(stats.enqueued).toBe(0);
    expect(enqueueRebuildSkillProfile).not.toHaveBeenCalled();
  });

  it('enqueue падает на одном → errors учтён, цикл продолжается', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'p1', tenantId: 'org-1' },
      { id: 'p2', tenantId: 'org-1' },
    ]);
    enqueueRebuildSkillProfile
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue({ jobId: 'x' });

    const stats = await runBackfillSkillProfilesRebuild(prisma as never, coreQueue, {
      dryRun: false,
    });

    expect(stats.errors).toBe(1);
    expect(stats.enqueued).toBe(1);
    expect(enqueueRebuildSkillProfile).toHaveBeenCalledTimes(2);
  });

  it('фильтр tenant прокинут в findMany', async () => {
    findMany.mockResolvedValueOnce([]);

    await runBackfillSkillProfilesRebuild(prisma as never, coreQueue, {
      tenantId: 'org-7',
      dryRun: true,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active', tenantId: 'org-7' }),
      }),
    );
  });
});
