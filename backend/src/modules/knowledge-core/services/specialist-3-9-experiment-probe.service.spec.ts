import type { Experiment } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ProbeService } from '../../probe/probe.service';

import type { OwnerResolverService } from './owner-resolver.service';
import { Specialist39ExperimentProbeService } from './specialist-3-9-experiment-probe.service';

function makeExperiment(): Experiment {
  return {
    id: 'exp-1',
    tenantId: 'org-1',
    name: 'Эксперимент с прайсингом',
    status: 'hypothesis',
    ownerEntityId: null,
    personSubjectIds: ['person-1'],
    currentResult: null,
    lessonsJson: null,
    createdAt: new Date(Date.now() - 48 * 3600 * 1000),
    startedAt: null,
  } as unknown as Experiment;
}

function makeEnv(args: { updateCount: number }): {
  service: Specialist39ExperimentProbeService;
  suggest: ReturnType<typeof vi.fn>;
  experimentUpdateMany: ReturnType<typeof vi.fn>;
  feedPublish: ReturnType<typeof vi.fn>;
  incOwnerResolution: ReturnType<typeof vi.fn>;
} {
  const experimentUpdateMany = vi.fn().mockResolvedValue({ count: args.updateCount });
  const prisma = {
    experiment: {
      findMany: vi.fn().mockResolvedValue([makeExperiment()]),
      updateMany: experimentUpdateMany,
    },
    membership: {
      findMany: vi.fn().mockResolvedValue([{ userId: 'admin-1' }]),
    },
    person: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'person-1',
          name: 'Пётр Петров',
          userId: 'user-cand',
          entityId: 'entity-77',
        },
      ]),
    },
  } as unknown as PrismaService;

  const conversational = {
    sendNotification: vi.fn().mockResolvedValue({ id: 'n-1' }),
  } as unknown as ConversationalService;

  const incOwnerResolution = vi.fn();
  const metrics = {
    incCoreSpecialistProbeEvent: vi.fn(),
    incOwnerResolution,
  } as unknown as BusinessMetricsService;

  const cfg = {
    experiments: { runningProbeThresholdDays: 30 },
  } as unknown as TypedConfigService;

  const suggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p-1' });
  const probeService = { suggest } as unknown as ProbeService;

  const ownerResolver = {
    resolve: vi.fn().mockResolvedValue({ kind: 'resolved', userId: 'user-cand' }),
  } as unknown as OwnerResolverService;

  const feedPublish = vi.fn().mockResolvedValue({ id: 'feed-1' });
  const activityFeed = {
    publish: feedPublish,
  } as unknown as ActivityFeedService;

  return {
    service: new Specialist39ExperimentProbeService(
      prisma,
      conversational,
      metrics,
      cfg,
      probeService,
      ownerResolver,
      activityFeed,
    ),
    suggest,
    experimentUpdateMany,
    feedPublish,
    incOwnerResolution,
  };
}

describe('Specialist39ExperimentProbeService — M-3 optimistic авто-назначение', () => {
  it('count=1 → авто-назначение с условием ownerEntityId:null в where, лента опубликована, probe НЕ шлётся', async () => {
    const env = makeEnv({ updateCount: 1 });

    const emitted = await env.service.checkNoOwnerForOrg('org-1');

    expect(env.experimentUpdateMany).toHaveBeenCalledTimes(1);
    const upd = env.experimentUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; ownerEntityId: null };
      data: { ownerEntityId: string };
    };
    expect(upd.where).toEqual({
      id: 'exp-1',
      tenantId: 'org-1',
      ownerEntityId: null,
    });
    expect(upd.data.ownerEntityId).toBe('entity-77');

    expect(env.feedPublish).toHaveBeenCalledTimes(1);
    expect(env.suggest).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'auto' });
    expect(emitted).toBe(0);
  });

  it('count=0 (владелец назначен параллельно) → лента НЕ публикуется, probe НЕ шлётся (тихий skip)', async () => {
    const env = makeEnv({ updateCount: 0 });

    const emitted = await env.service.checkNoOwnerForOrg('org-1');

    expect(env.experimentUpdateMany).toHaveBeenCalledTimes(1);
    expect(env.feedPublish).not.toHaveBeenCalled();
    expect(env.suggest).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).not.toHaveBeenCalledWith({
      outcome: 'auto',
    });
    expect(emitted).toBe(0);
  });
});
