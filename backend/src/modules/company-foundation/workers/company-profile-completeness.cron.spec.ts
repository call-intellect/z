import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProbeService } from '../../probe/probe.service';
import type { CompanyProfileService } from '../services/company-profile.service';

import { CompanyProfileCompletenessCron } from './company-profile-completeness.cron';

function makeCron(args: {
  enabled?: boolean;
  orgs?: { id: string }[];
  profile?: Record<string, unknown> | null;
  ownerUserId?: string | null;
  withProbe?: boolean;
}): {
  cron: CompanyProfileCompletenessCron;
  suggest: ReturnType<typeof vi.fn>;
  membershipFindFirst: ReturnType<typeof vi.fn>;
} {
  const suggest = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p1' });
  const membershipFindFirst = vi
    .fn()
    .mockResolvedValue(
      args.ownerUserId === undefined
        ? { userId: 'owner-1' }
        : args.ownerUserId === null
          ? null
          : { userId: args.ownerUserId },
    );
  const prisma = {
    org: {
      findMany: vi.fn().mockResolvedValue(args.orgs ?? [{ id: 'org-1' }]),
    },
    membership: { findFirst: membershipFindFirst },
  } as unknown as PrismaService;
  const companyProfile = {
    getRaw: vi
      .fn()
      .mockResolvedValue(
        args.profile === undefined ? { id: 'cp-1' } : args.profile,
      ),
  } as unknown as CompanyProfileService;
  const metrics = {
    incCoreSpecialistProbeEvent: vi.fn(),
  } as unknown as BusinessMetricsService;
  const cfg = {
    companyProfile: { completenessProbeEnabled: args.enabled ?? true },
  } as unknown as TypedConfigService;
  const probeService =
    args.withProbe === false
      ? undefined
      : ({ suggest } as unknown as ProbeService);

  return {
    cron: new CompanyProfileCompletenessCron(
      prisma,
      companyProfile,
      metrics,
      cfg,
      probeService,
    ),
    suggest,
    membershipFindFirst,
  };
}

describe('CompanyProfileCompletenessCron', () => {
  it('пустой missionJson → suggest c reason companyprofile.missing_mission', async () => {
    const { cron, suggest } = makeCron({
      profile: { id: 'cp-1', missionJson: null, visionJson: { contentMd: 'V' }, strategyJson: { contentMd: 'S' } },
    });
    await cron.run();
    expect(suggest).toHaveBeenCalledTimes(1);
    const call = suggest.mock.calls[0]![0] as {
      reason: string;
      recipientCandidates: string[];
      payload: { contextCardKind: string; contextCardId: string };
    };
    expect(call.reason).toBe('companyprofile.missing_mission');
    expect(call.recipientCandidates).toEqual(['owner-1']);
    expect(call.payload.contextCardKind).toBe('company_profile');
    expect(call.payload.contextCardId).toBe('cp-1');
  });

  it('профиль полностью заполнен → suggest НЕ вызван', async () => {
    const { cron, suggest } = makeCron({
      profile: {
        id: 'cp-1',
        missionJson: { contentMd: 'M' },
        visionJson: { contentMd: 'V' },
        strategyJson: { contentMd: 'S' },
      },
    });
    await cron.run();
    expect(suggest).not.toHaveBeenCalled();
  });

  it('все три поля пусты → три suggest по каждому reason', async () => {
    const { cron, suggest } = makeCron({
      profile: { id: 'cp-1', missionJson: null, visionJson: null, strategyJson: null },
    });
    await cron.run();
    expect(suggest).toHaveBeenCalledTimes(3);
    const reasons = suggest.mock.calls.map((c) => (c[0] as { reason: string }).reason);
    expect(reasons).toEqual([
      'companyprofile.missing_mission',
      'companyprofile.missing_vision',
      'companyprofile.missing_strategy',
    ]);
  });

  it('owner не найден → suggest НЕ вызван, не падает', async () => {
    const { cron, suggest } = makeCron({
      profile: { id: 'cp-1', missionJson: null, visionJson: null, strategyJson: null },
      ownerUserId: null,
    });
    await expect(cron.run()).resolves.toBeUndefined();
    expect(suggest).not.toHaveBeenCalled();
  });

  it('kill-switch выключен → org.findMany не зовётся, suggest нет', async () => {
    const { cron, suggest } = makeCron({
      enabled: false,
      profile: { id: 'cp-1', missionJson: null },
    });
    await cron.run();
    expect(suggest).not.toHaveBeenCalled();
  });

  it('профиль ещё не создан (getRaw=null) → все три повода (поля пусты)', async () => {
    const { cron, suggest } = makeCron({ profile: null });
    await cron.run();
    expect(suggest).toHaveBeenCalledTimes(3);
    const first = suggest.mock.calls[0]![0] as { payload: { contextCardId: string } };
    expect(first.payload.contextCardId).toBe('org-1');
  });

  it('ProbeService недоступен → ранний выход без падения', async () => {
    const { cron, suggest } = makeCron({
      withProbe: false,
      profile: { id: 'cp-1', missionJson: null },
    });
    await expect(cron.run()).resolves.toBeUndefined();
    expect(suggest).not.toHaveBeenCalled();
  });
});
