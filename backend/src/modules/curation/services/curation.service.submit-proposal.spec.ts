import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationService } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

function buildMetrics(): BusinessMetricsService {
  return {
    incCurationItem: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function makeService(args: {
  curationItemCreate: ReturnType<typeof vi.fn>;
  resolveCurators: ReturnType<typeof vi.fn>;
  metrics?: BusinessMetricsService;
}): CurationService {
  const prisma = {
    curationItem: { create: args.curationItemCreate },
  } as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const metrics = args.metrics ?? buildMetrics();
  const conversational = {} as unknown as ConversationalService;
  const routing = {
    resolveCurators: args.resolveCurators,
  } as unknown as CuratorRoutingService;

  return new CurationService(prisma, cfg, metrics, conversational, routing, null, null, null);
}

describe('CurationService.submitProposal — E1', () => {
  let create: ReturnType<typeof vi.fn>;
  let resolveCurators: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'ci-1',
      ...data,
    }));
    resolveCurators = vi.fn().mockResolvedValue(['curator-1']);
  });

  it('создаёт CurationItem(pending, via=user_correction) с proposedPayload и кураторами', async () => {
    const svc = makeService({ curationItemCreate: create, resolveCurators });

    const res = await svc.submitProposal({
      tenantId: 't-1',
      resourceType: 'decision',
      resourceId: 'd-1',
      proposedPayload: { statement: 'Новая суть' },
      submittedBy: 'u-1',
      reason: 'опечатка',
    });

    expect(res).toEqual({ curationItemId: 'ci-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't-1',
          resourceType: 'decision',
          resourceId: 'd-1',
          level: 'light',
          status: 'pending',
          proposedPayload: { statement: 'Новая суть' },
          candidateCuratorIds: ['curator-1'],
          triageReason: expect.objectContaining({
            via: 'user_correction',
            reason: 'опечатка',
            submittedBy: 'u-1',
          }),
        }),
      }),
    );
  });

  it('routing упал → candidates=[] (item всё равно создаётся)', async () => {
    resolveCurators.mockRejectedValue(new Error('routing down'));
    const svc = makeService({ curationItemCreate: create, resolveCurators });

    const res = await svc.submitProposal({
      tenantId: 't-1',
      resourceType: 'policy',
      resourceId: 'pol-1',
      proposedPayload: { name: 'Новое имя' },
      submittedBy: 'u-2',
    });

    expect(res).toEqual({ curationItemId: 'ci-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ candidateCuratorIds: [] }),
      }),
    );
  });

  it('пустой submittedBy → BadRequest', async () => {
    const svc = makeService({ curationItemCreate: create, resolveCurators });

    await expect(
      svc.submitProposal({
        tenantId: 't-1',
        resourceType: 'decision',
        resourceId: 'd-1',
        proposedPayload: {},
        submittedBy: '',
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
