/**
 * W2 autonomy (2026-06-12) — Specialist31ProbeService × «лестница владельца»
 * для `regulation.missing_owner`:
 *   - resolved (единственный держатель роли) → АВТО-назначение ownerPersonId,
 *     запись в ленту, probe НЕ шлётся;
 *   - ambiguous (несколько держателей) → probe-вопрос-выбор с именами.
 *
 * Все зависимости мокированы.
 */
import type { Regulation } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ProbeService } from '../../probe/probe.service';

import type { OwnerResolverService } from './owner-resolver.service';
import { Specialist31ProbeService } from './specialist-3-1-probe.service';

function makeRegulation(): Regulation {
  return {
    id: 'reg-1',
    tenantId: 'org-1',
    name: 'Регламент возвратов',
    status: 'active',
    ownerPersonId: null,
    // scope задан → checkScopeUnclear не срабатывает; роль-ступень лестницы.
    scope: 'role:role-1',
    // lastConfirmedAt null → checkStale не срабатывает.
    lastConfirmedAt: null,
    sourceBlockIds: [],
  } as unknown as Regulation;
}

function makeEnv(resolution:
  | { kind: 'resolved'; userId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' },
): {
  service: Specialist31ProbeService;
  suggest: ReturnType<typeof vi.fn>;
  regulationUpdateMany: ReturnType<typeof vi.fn>;
  feedPublish: ReturnType<typeof vi.fn>;
  incOwnerResolution: ReturnType<typeof vi.fn>;
} {
  const regulationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    regulation: { updateMany: regulationUpdateMany },
    membership: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    },
    person: {
      // АВТО-ветка: Person держателя роли.
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'person-1', name: 'Иван Иванов' }),
      // ambiguous-ветка: имена кандидатов.
      findMany: vi
        .fn()
        .mockResolvedValue([{ name: 'Иван Иванов' }, { name: 'Пётр Петров' }]),
    },
  } as unknown as PrismaService;

  const sendNotification = vi.fn().mockResolvedValue({ id: 'n-1' });
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const incOwnerResolution = vi.fn();
  const metrics = {
    incCoreSpecialistProbeEvent: vi.fn(),
    incOwnerResolution,
  } as unknown as BusinessMetricsService;

  const suggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p-1' });
  const probeService = { suggest } as unknown as ProbeService;

  const ownerResolver = {
    resolve: vi.fn().mockResolvedValue(resolution),
  } as unknown as OwnerResolverService;

  const feedPublish = vi.fn().mockResolvedValue({ id: 'feed-1' });
  const activityFeed = {
    publish: feedPublish,
  } as unknown as ActivityFeedService;

  return {
    service: new Specialist31ProbeService(
      prisma,
      conversational,
      metrics,
      probeService,
      ownerResolver,
      activityFeed,
    ),
    suggest,
    regulationUpdateMany,
    feedPublish,
    incOwnerResolution,
  };
}

describe('Specialist31ProbeService × OwnerResolver (regulation.missing_owner)', () => {
  it('resolved → АВТО: update ownerPersonId + лента, probe НЕ шлётся', async () => {
    const env = makeEnv({ kind: 'resolved', userId: 'user-holder' });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).toHaveBeenCalledTimes(1);
    const upd = env.regulationUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string };
      data: { ownerPersonId: string };
    };
    expect(upd.where).toEqual({ id: 'reg-1', tenantId: 'org-1' });
    expect(upd.data.ownerPersonId).toBe('person-1');

    expect(env.feedPublish).toHaveBeenCalledTimes(1);
    const feed = env.feedPublish.mock.calls[0]![0] as { title: string };
    expect(feed.title).toContain('Кора назначила владельца');
    expect(feed.title).toContain('Иван Иванов');

    expect(env.suggest).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'auto' });
  });

  it('ambiguous → probe-вопрос-выбор с именами кандидатов, без авто-записи', async () => {
    const env = makeEnv({
      kind: 'ambiguous',
      candidates: ['user-a', 'user-b'],
    });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).not.toHaveBeenCalled();
    expect(env.feedPublish).not.toHaveBeenCalled();

    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      payload: { message: string };
    };
    expect(call.reason).toBe('regulation.missing_owner');
    expect(call.payload.message).toContain('Кого назначить владельцем');
    expect(call.payload.message).toContain('Иван Иванов или Пётр Петров');
    expect(env.incOwnerResolution).toHaveBeenCalledWith({
      outcome: 'ambiguous',
    });
  });

  it('none → прежний probe «назначить владельца?»', async () => {
    const env = makeEnv({ kind: 'none' });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).not.toHaveBeenCalled();
    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      payload: { message: string };
    };
    expect(call.payload.message).toContain(
      'нет ответственного — назначить владельца?',
    );
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'none' });
  });
});
