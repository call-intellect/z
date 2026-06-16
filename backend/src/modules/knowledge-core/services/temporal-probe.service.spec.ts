import { describe, expect, it, vi } from 'vitest';

import { TemporalProbeService } from './temporal-probe.service';

function makeService(args: {
  staleBlocks: Array<{
    id: string;
    name: string;
    trustedAnswer: string;
    signalType: string;
    validFrom: Date;
    entities: Array<{ entityId: string }>;
  }>;
  freshBy: Map<string, { id: string; name: string; trustedAnswer: string; validFrom: Date } | null>;
  memberships: Array<{ userId: string }>;
  probeSuggest: ReturnType<typeof vi.fn>;
}) {
  const findManyMock = vi.fn(async () => args.staleBlocks);
  let currentStale: string | null = null;
  const findFirstMock = vi.fn(async (q: unknown) => {
    const query = q as { where: { id: { not: string }; signalType: string } };
    currentStale = query.where.id.not;
    return args.freshBy.get(currentStale!) ?? null;
  });
  const fakePrisma = {
    org: {
      findMany: async () => [{ id: 'org_1' }],
      findUnique: async () => ({ ownerId: 'u_owner' }),
    },
    ideaBlock: {
      findMany: findManyMock,
      findFirst: findFirstMock,
    },
    membership: {
      findMany: async () => args.memberships,
    },
    probeEvent: {
      findMany: async () => [],
    },
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[0];

  const fakeCfg = {
    bitemporal: { factSignalTypes: ['fact_state'] },
    temporalProbe: { limitPerOrg: 50, escalateAfterWeeks: 2 },
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[1];

  const fakeProbe = {
    suggest: args.probeSuggest,
  } as unknown as ConstructorParameters<typeof TemporalProbeService>[2];

  return new TemporalProbeService(fakePrisma, fakeCfg, fakeProbe);
}

describe('TemporalProbeService.runForOrg', () => {
  it('есть расхождение → emit probe.suggest с reason=temporal.fact_stale_contradiction', async () => {
    const suggestMock = vi.fn().mockResolvedValue({ ok: true, probeEventId: 'pe_1' });
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'CEO компании X',
          trustedAnswer: 'Иван',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_company' }],
        },
      ],
      freshBy: new Map([
        [
          'b_old',
          {
            id: 'b_new',
            name: 'CEO компании X',
            trustedAnswer: 'Пётр',
            validFrom: new Date(),
          },
        ],
      ]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(1);
    expect(suggestMock).toHaveBeenCalledTimes(1);
    const callArgs = suggestMock.mock.calls[0]?.[0] as {
      reason: string;
      recipientCandidates: string[];
    };
    expect(callArgs.reason).toBe('temporal.fact_stale_contradiction');
    expect(callArgs.recipientCandidates).toEqual(['u_admin']);
  });

  it('свежий блок с тем же trustedAnswer → probe не эмитится', async () => {
    const suggestMock = vi.fn();
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'CEO X',
          trustedAnswer: 'Иван',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_company' }],
        },
      ],
      freshBy: new Map([
        [
          'b_old',
          {
            id: 'b_new',
            name: 'CEO X',
            trustedAnswer: 'иван  ',
            validFrom: new Date(),
          },
        ],
      ]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(0);
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('нет свежего блока → probe не эмитится', async () => {
    const suggestMock = vi.fn();
    const svc = makeService({
      staleBlocks: [
        {
          id: 'b_old',
          name: 'X',
          trustedAnswer: 'A',
          signalType: 'fact_state',
          validFrom: new Date('2024-01-01'),
          entities: [{ entityId: 'e_x' }],
        },
      ],
      freshBy: new Map([['b_old', null]]),
      memberships: [{ userId: 'u_admin' }],
      probeSuggest: suggestMock,
    });
    const stats = await svc.runForOrg('org_1');
    expect(stats.probesEmitted).toBe(0);
    expect(suggestMock).not.toHaveBeenCalled();
  });
});
