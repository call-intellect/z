import { describe, expect, it } from 'vitest';

import type {
  DecisionThroughputApi,
  StalledDecisionsApi,
} from '@/api/operations-dashboard.api';
import {
  fromDecisionThroughputApi,
  fromStalledDecisionsApi,
} from './decision-throughput';

function throughput(
  overrides: Partial<DecisionThroughputApi> = {},
): DecisionThroughputApi {
  return {
    total: 10,
    doneWithOutcomes: 8,
    throughputPercent: 80,
    from: '2026-03-18',
    to: '2026-06-16',
    ...overrides,
  };
}

describe('fromDecisionThroughputApi', () => {
  it('throughputPercent=85 → progressTone=teal', () => {
    expect(
      fromDecisionThroughputApi(throughput({ throughputPercent: 85 }))
        .progressTone,
    ).toBe('teal');
  });

  it('throughputPercent=50 → progressTone=warn', () => {
    expect(
      fromDecisionThroughputApi(throughput({ throughputPercent: 50 }))
        .progressTone,
    ).toBe('warn');
  });

  it('throughputPercent=10 → progressTone=risk', () => {
    expect(
      fromDecisionThroughputApi(throughput({ throughputPercent: 10 }))
        .progressTone,
    ).toBe('risk');
  });

  it('пробрасывает total/doneWithOutcomes/from/to', () => {
    const d = fromDecisionThroughputApi(
      throughput({
        total: 42,
        doneWithOutcomes: 21,
        from: '2026-01-01',
        to: '2026-04-01',
      }),
    );
    expect(d.total).toBe(42);
    expect(d.doneWithOutcomes).toBe(21);
    expect(d.from).toBe('2026-01-01');
    expect(d.to).toBe('2026-04-01');
  });
});

describe('fromStalledDecisionsApi', () => {
  it('decidedAt=null → null', () => {
    const api: StalledDecisionsApi = {
      items: [
        {
          id: 'a',
          statement: 'без даты',
          decidedAt: null,
          ageDays: 12,
          implementationCheckedAt: null,
        },
      ],
    };
    expect(fromStalledDecisionsApi(api)[0].decidedAt).toBeNull();
  });

  it('ISO-строка decidedAt → instanceof Date', () => {
    const api: StalledDecisionsApi = {
      items: [
        {
          id: 'b',
          statement: 'с датой',
          decidedAt: '2026-05-01T10:00:00.000Z',
          ageDays: 30,
          implementationCheckedAt: '2026-05-10T10:00:00.000Z',
        },
      ],
    };
    expect(fromStalledDecisionsApi(api)[0].decidedAt).toBeInstanceOf(Date);
  });

  it('пустой items → []', () => {
    expect(fromStalledDecisionsApi({ items: [] })).toEqual([]);
  });
});
