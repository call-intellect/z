import { describe, expect, it, vi } from 'vitest';

import { ExecutablePersonaVersioningService } from './executable-persona-versioning.service';

/**
 * Б46 — unit-тесты ExecutablePersonaVersioningService.triggerRebuild.
 *
 * Главный сценарий: idempotency-замок не должен забираться на ХОЛОСТОМ триггере
 * (профиль не найден / мало traits) — иначе легитимная пересборка подавлялась
 * бы на TTL после пустого срабатывания. Замок берётся ТОЛЬКО после успешного
 * pre-check, перед builder'ом.
 */
describe('ExecutablePersonaVersioningService.triggerRebuild — Б46 lock после pre-check', () => {
  function makeService(opts: {
    profile: {
      id: string;
      status: string;
      _count: { traits: number };
    } | null;
    minTraits?: number;
    buildResult?: { id: string } | null;
    lockAcquired?: boolean;
  }): {
    service: ExecutablePersonaVersioningService;
    redisSet: ReturnType<typeof vi.fn>;
    buildForProfile: ReturnType<typeof vi.fn>;
  } {
    const redisSet = vi.fn(async () =>
      (opts.lockAcquired ?? true) ? 'OK' : null,
    );
    const buildForProfile = vi.fn(async () =>
      opts.buildResult === undefined
        ? { id: 'persona-new' }
        : opts.buildResult,
    );

    const prisma = {
      skillProfile: {
        findUnique: vi.fn(async () => opts.profile),
      },
    };
    const redis = { client: { set: redisSet } };
    const cfg = {
      persona: {
        minTraits: opts.minTraits ?? 3,
        minRebuildIntervalMinutes: 60,
      },
    };
    const builder = { buildForProfile };

    const service = new ExecutablePersonaVersioningService(
      prisma as never,
      redis as never,
      cfg as never,
      builder as never,
    );
    return { service, redisSet, buildForProfile };
  }

  it('профиль не найден → reason=profile_not_found И замок НЕ берётся', async () => {
    const { service, redisSet, buildForProfile } = makeService({
      profile: null,
    });

    const res = await service.triggerRebuild({
      profileId: 'p1',
      reason: 'trait_delta' as never,
    });

    expect(res).toEqual({ built: false, reason: 'profile_not_found' });
    // Главное по Б46: lock не тронут на холостом триггере.
    expect(redisSet).not.toHaveBeenCalled();
    expect(buildForProfile).not.toHaveBeenCalled();
  });

  it('мало traits → reason=insufficient_traits И замок НЕ берётся', async () => {
    const { service, redisSet } = makeService({
      profile: { id: 'p1', status: 'active', _count: { traits: 1 } },
      minTraits: 3,
    });

    const res = await service.triggerRebuild({
      profileId: 'p1',
      reason: 'trait_delta' as never,
    });

    expect(res).toEqual({ built: false, reason: 'insufficient_traits' });
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('pre-check ок → замок берётся ПОСЛЕ findUnique, затем builder; success', async () => {
    const calls: string[] = [];
    const redisSet = vi.fn(async () => {
      calls.push('lock');
      return 'OK';
    });
    const buildForProfile = vi.fn(async () => {
      calls.push('build');
      return { id: 'persona-new' };
    });
    const findUnique = vi.fn(async () => {
      calls.push('precheck');
      return { id: 'p1', status: 'active', _count: { traits: 5 } };
    });
    const prisma = { skillProfile: { findUnique } };
    const redis = { client: { set: redisSet } };
    const cfg = {
      persona: { minTraits: 3, minRebuildIntervalMinutes: 60 },
    };
    const builder = { buildForProfile };
    const service = new ExecutablePersonaVersioningService(
      prisma as never,
      redis as never,
      cfg as never,
      builder as never,
    );

    const res = await service.triggerRebuild({
      profileId: 'p1',
      reason: 'trait_delta' as never,
    });

    expect(res).toEqual({ built: true, personaId: 'persona-new' });
    // Порядок: pre-check ДО замка (Б46), затем build.
    expect(calls).toEqual(['precheck', 'lock', 'build']);
  });

  it('замок занят (другой триггер уже идёт) → reason=locked, builder не вызывается', async () => {
    const { service, buildForProfile } = makeService({
      profile: { id: 'p1', status: 'active', _count: { traits: 5 } },
      lockAcquired: false,
    });

    const res = await service.triggerRebuild({
      profileId: 'p1',
      reason: 'trait_delta' as never,
    });

    expect(res).toEqual({ built: false, reason: 'locked' });
    expect(buildForProfile).not.toHaveBeenCalled();
  });
});
