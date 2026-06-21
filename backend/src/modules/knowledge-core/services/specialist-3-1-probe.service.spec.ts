import type { Regulation } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
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
  opts?: { existenceConfirmEnabled?: boolean; confirmGraceDays?: number },
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
      findFirst: vi.fn().mockResolvedValue({ id: 'person-1', name: 'Иван Иванов' }),
      findMany: vi.fn().mockResolvedValue([{ name: 'Иван Иванов' }, { name: 'Пётр Петров' }]),
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

  const existenceConfirmEnabled = opts?.existenceConfirmEnabled ?? true;
  const confirmGraceDays = opts?.confirmGraceDays ?? 2;
  const cfg = {
    getDynamic: vi.fn(async (key: string) => {
      if (key === 'probe.existenceConfirmEnabled') return existenceConfirmEnabled;
      if (key === 'probe.confirmGraceDays') return confirmGraceDays;
      return undefined;
    }),
  } as unknown as TypedConfigService;

  return {
    service: new Specialist31ProbeService(
      prisma,
      conversational,
      metrics,
      probeService,
      ownerResolver,
      activityFeed,
      cfg,
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

    expect(env.suggest).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'auto' });
  });

  it('ambiguous + existenceConfirm ON (дефолт) → existence_confirm с именами кандидатов и грейсом', async () => {
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
      payload: { message: string; suggestedActions: string[] };
      notBeforeAt?: Date;
    };
    expect(call.reason).toBe('regulation.existence_confirm');
    expect(call.payload.message).toContain('Кора зафиксировала');
    expect(call.payload.message).toContain('Иван Иванов или Пётр Петров');
    expect(call.payload.suggestedActions).toEqual([
      'Оставить',
      'Переименовать',
      'Назначить владельца',
      'Удалить',
    ]);
    expect(call.notBeforeAt).toBeInstanceOf(Date);
    expect(env.incOwnerResolution).toHaveBeenCalledWith({
      outcome: 'ambiguous',
    });
  });

  it('ambiguous + existenceConfirm OFF (kill-switch) → прежний probe regulation.missing_owner', async () => {
    const env = makeEnv(
      { kind: 'ambiguous', candidates: ['user-a', 'user-b'] },
      { existenceConfirmEnabled: false },
    );

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      payload: { message: string };
      notBeforeAt?: Date;
    };
    expect(call.reason).toBe('regulation.missing_owner');
    expect(call.payload.message).toContain('Кого назначить владельцем');
    expect(call.notBeforeAt).toBeUndefined();
  });

  it('none + existenceConfirm ON (дефолт) → existence_confirm после грейса', async () => {
    const env = makeEnv({ kind: 'none' });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).not.toHaveBeenCalled();
    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      payload: { message: string; suggestedActions: string[] };
      notBeforeAt?: Date;
    };
    expect(call.reason).toBe('regulation.existence_confirm');
    expect(call.payload.message).toContain('Кора зафиксировала');
    expect(call.payload.suggestedActions).toEqual([
      'Оставить',
      'Переименовать',
      'Назначить владельца',
      'Удалить',
    ]);
    expect(call.notBeforeAt).toBeInstanceOf(Date);
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'none' });
  });

  it('none + existenceConfirm OFF (kill-switch) → прежний probe «назначить владельца?», без грейса', async () => {
    const env = makeEnv({ kind: 'none' }, { existenceConfirmEnabled: false });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      payload: { message: string };
      notBeforeAt?: Date;
    };
    expect(call.reason).toBe('regulation.missing_owner');
    expect(call.payload.message).toContain('нет ответственного — назначить владельца?');
    expect(call.notBeforeAt).toBeUndefined();
    expect(env.incOwnerResolution).toHaveBeenCalledWith({ outcome: 'none' });
  });

  it('none + confirmGraceDays=0 → existence_confirm без notBeforeAt', async () => {
    const env = makeEnv({ kind: 'none' }, { confirmGraceDays: 0 });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.suggest).toHaveBeenCalledTimes(1);
    const call = env.suggest.mock.calls[0]![0] as {
      reason: string;
      notBeforeAt?: Date;
    };
    expect(call.reason).toBe('regulation.existence_confirm');
    expect(call.notBeforeAt).toBeUndefined();
  });

  it('M-3: resolved, но updateMany вернул count=0 (владелец назначен параллельно) → лента НЕ публикуется, probe НЕ шлётся', async () => {
    const env = makeEnv({ kind: 'resolved', userId: 'user-holder' });
    env.regulationUpdateMany.mockResolvedValue({ count: 0 });

    await env.service.checkAndEmitProbesRegulation(makeRegulation());

    expect(env.regulationUpdateMany).toHaveBeenCalledTimes(1);
    expect(env.feedPublish).not.toHaveBeenCalled();
    expect(env.suggest).not.toHaveBeenCalled();
    expect(env.incOwnerResolution).not.toHaveBeenCalledWith({
      outcome: 'auto',
    });
  });
});
