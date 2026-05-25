import { describe, expect, it, vi } from 'vitest';

import { SignalTypeStatsCron } from './signal-type-stats.cron';

/**
 * G.2 KC-Temporal (2026-05-25) — unit-тест корректного группирования и
 * подсчёта Markov-переходов signalType.
 */

function makeCron(args: {
  blocks: Array<{
    id: string;
    signalType: string;
    createdAt: Date;
    evidence: Array<{ rawEventId: string }>;
  }>;
  setSpy?: ReturnType<typeof vi.fn>;
}) {
  const setSpy = args.setSpy ?? vi.fn();
  const fakePrisma = {
    org: { findMany: async () => [{ id: 'org_1' }] },
    ideaBlock: { findMany: async () => args.blocks },
  } as unknown as ConstructorParameters<typeof SignalTypeStatsCron>[0];
  const fakeSettings = {
    set: setSpy,
  } as unknown as ConstructorParameters<typeof SignalTypeStatsCron>[1];
  return { cron: new SignalTypeStatsCron(fakePrisma, fakeSettings), setSpy };
}

describe('SignalTypeStatsCron.processOrg', () => {
  it('правильно группирует по rawEventId и считает переходы (signalType_i, signalType_{i+1})', async () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const earlier = new Date(now.getTime() - 60_000);
    const later = new Date(now.getTime() - 30_000);
    const muchLater = new Date(now.getTime() - 10_000);
    const { cron } = makeCron({
      blocks: [
        // rawEvent_1: fact_state → commitment → decision (вкладывает 2 перехода).
        {
          id: 'b1',
          signalType: 'fact_state',
          createdAt: earlier,
          evidence: [{ rawEventId: 'r_1' }],
        },
        {
          id: 'b2',
          signalType: 'commitment',
          createdAt: later,
          evidence: [{ rawEventId: 'r_1' }],
        },
        {
          id: 'b3',
          signalType: 'decision',
          createdAt: muchLater,
          evidence: [{ rawEventId: 'r_1' }],
        },
        // rawEvent_2: один блок — ноль переходов.
        {
          id: 'b4',
          signalType: 'risk',
          createdAt: now,
          evidence: [{ rawEventId: 'r_2' }],
        },
        // Блок без evidence — игнорируется.
        {
          id: 'b5',
          signalType: 'fact_state',
          createdAt: now,
          evidence: [],
        },
      ],
    });

    const window30 = new Date(now.getTime() - 30 * 86_400_000);
    const window7 = new Date(now.getTime() - 7 * 86_400_000);
    const res = await cron.processOrg('org_1', window30, window7);

    // Ожидаемая матрица: { fact_state: { commitment: 1 }, commitment: { decision: 1 } }
    expect(res.matrix.fact_state?.commitment).toBe(1);
    expect(res.matrix.commitment?.decision).toBe(1);
    expect(res.matrix.risk).toBeUndefined();
    expect(res.blocks).toBe(5);
    // distribution7d должно учесть только блоки внутри окна — все 5 блоков
    // создаются от now, что попадает в window7 (10s/30s/60s назад).
    expect(res.distribution7d.fact_state).toBeGreaterThan(0);
  });
});
