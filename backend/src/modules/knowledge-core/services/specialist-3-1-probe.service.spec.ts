import type { Regulation } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';

import type { OwnerResolverService } from './owner-resolver.service';
import { Specialist31ProbeService } from './specialist-3-1-probe.service';

function makeRegulation(): Regulation {
  return {
    id: 'reg-1',
    tenantId: 'org-1',
    name: 'Регламент возвратов',
    status: 'active',
    ownerPersonId: null,
    scope: 'role:role-1',
    lastConfirmedAt: null,
    sourceBlockIds: [],
  } as unknown as Regulation;
}

function makeEnv(
  resolution:
    | { kind: 'resolved'; userId: string }
    | { kind: 'ambiguous'; candidates: string[] }
    | { kind: 'none' },
): {
  service: Specialist31ProbeService;
  regulationUpdateMany: ReturnType<typeof vi.fn>;
  feedPublish: ReturnType<typeof vi.fn>;
  incOwnerResolution: ReturnType<typeof vi.fn>;
} {
  const regulationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    regulation: { updateMany: regulationUpdateMany },
    person: {
      findFirst: vi.fn().mockResolvedValue({ id: 'person-1', name: 'Иван Иванов' }),
    },
  } as unknown as PrismaService;

  const incOwnerResolution = vi.fn();
  const metrics = {
    incOwnerResolution,
  } as unknown as BusinessMetricsService;

  const ownerResolver = {
    resolve: vi.fn().mockResolvedValue(resolution),
  } as unknown as OwnerResolverService;

  const feedPublish = vi.fn().mockResolvedValue({ id: 'feed-1' });
  const activityFeed = {
    publish: feedPublish,
  } as unknown as ActivityFeedService;

  return {
    service: new Specialist31ProbeService(prisma, metrics, ownerResolver, activityFeed),
    regulationUpdateMany,
    feedPublish,
    incOwnerResolution,
  };
}

describe('Specialist31ProbeService × OwnerResolver (молчаливое авто-назначение владельца)', () => {
  it('resolved → АВТО: update ownerPersonId + лента, метрика auto', async () => {
    const env = makeEnv({ kind: 'resolved', userId: 'user-holder' });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).toHaveBeenCalledTimes(1);
    const upd = env.regulationUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; ownerPersonId: null };
      data: { ownerPersonId: string };
    };
    expect(upd.where).toEqual({
      id: 'reg-1',
      tenantId: 'org-1',
      ownerPersonId: null,
    });
    expect(upd.data.ownerPersonId).toBe('person-1');

    expect(env.feedPublish).toHaveBeenCalledTimes(1);
    const feed = env.feedPublish.mock.calls[0]![0] as { title: string };
    expect(feed.title).toContain('Кора назначила владельца');
    expect(feed.title).toContain('Иван Иванов');

    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'auto' });
  });

  it('ambiguous → probe/notification НЕ отправлен, метрика ambiguous', async () => {
    const env = makeEnv({
      kind: 'ambiguous',
      candidates: ['user-a', 'user-b'],
    });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).not.toHaveBeenCalled();
    expect(env.feedPublish).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({
      outcome: 'ambiguous',
    });
  });

  it('none → назначения нет, метрика none', async () => {
    const env = makeEnv({ kind: 'none' });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).not.toHaveBeenCalled();
    expect(env.feedPublish).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'none' });
  });

  it('M-3: resolved, но updateMany вернул count=0 (владелец назначен параллельно) → лента НЕ публикуется, метрика auto НЕ инкрементнута', async () => {
    const env = makeEnv({ kind: 'resolved', userId: 'user-holder' });
    env.regulationUpdateMany.mockResolvedValue({ count: 0 });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).toHaveBeenCalledTimes(1);
    expect(env.feedPublish).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).not.toHaveBeenCalledWith({
      outcome: 'auto',
    });
  });
});
