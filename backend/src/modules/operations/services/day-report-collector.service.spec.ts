import { describe, expect, it, vi } from 'vitest';

import { getLocalDate } from '../utils/local-date';

import { DayReportCollectorService } from './day-report-collector.service';

const TENANT = 'org-1';
const DATE_X = new Date('2026-06-29T09:30:00.000Z');
const DATE_X_LOCAL = getLocalDate(DATE_X, 'Europe/Moscow');

function makeBlock(args: {
  id: string;
  signalType: string;
  name: string;
  trustedAnswer: string;
  evidence: Array<{ authorPersonId: string | null; sourceTimestamp: Date | null }>;
}) {
  return {
    id: args.id,
    tenantId: TENANT,
    name: args.name,
    trustedAnswer: args.trustedAnswer,
    signalType: args.signalType,
    mergedIntoId: null,
    evidence: args.evidence.map((e, i) => ({
      id: `${args.id}-ev-${i}`,
      tenantId: TENANT,
      blockId: args.id,
      authorPersonId: e.authorPersonId,
      sourceTimestamp: e.sourceTimestamp,
      createdAt: e.sourceTimestamp ?? DATE_X,
      quote: 'q',
    })),
  };
}

function makeService(opts: {
  blocks: ReturnType<typeof makeBlock>[];
  persons: Array<{ id: string; timezone: string | null }>;
  verify?: ReturnType<typeof vi.fn>;
}) {
  const prisma = {
    ideaBlock: { findMany: vi.fn(async () => opts.blocks) },
    person: { findMany: vi.fn(async () => opts.persons) },
  };
  const metrics = {
    incDayReportCollected: vi.fn(),
    incDayReportBlockDroppedNoPerson: vi.fn(),
    incDayReportNotDoneVerifyCalls: vi.fn(),
  };
  const closureVerifier = {
    verify: opts.verify ?? vi.fn().mockResolvedValue(null),
  };
  const svc = new DayReportCollectorService(
    prisma as never,
    metrics as never,
    closureVerifier as never,
  );
  return { svc, prisma, metrics, closureVerifier };
}

function makeRaw(args: {
  plans?: Array<{ text: string; blockId: string }>;
  dones?: Array<{ text: string; blockId: string }>;
  blockers?: Array<{ text: string; blockId: string }>;
}) {
  return {
    personId: 'A',
    dateLocal: DATE_X_LOCAL,
    plans: args.plans ?? [],
    dones: args.dones ?? [],
    blockers: args.blockers ?? [],
    ideas: [],
  };
}

describe('DayReportCollectorService', () => {
  it('раскладывает блоки по вёдрам на каждого человека и отбрасывает evidence без автора', async () => {
    const { svc, metrics } = makeService({
      blocks: [
        makeBlock({
          id: 'block1',
          signalType: 'plan_item',
          name: 'План A',
          trustedAnswer: 'Сделать план A',
          evidence: [{ authorPersonId: 'A', sourceTimestamp: DATE_X }],
        }),
        makeBlock({
          id: 'block2',
          signalType: 'done_item',
          name: 'Готово A',
          trustedAnswer: 'Завершил A',
          evidence: [{ authorPersonId: 'A', sourceTimestamp: DATE_X }],
        }),
        makeBlock({
          id: 'block3',
          signalType: 'idea',
          name: 'Идея B',
          trustedAnswer: 'Идея от B',
          evidence: [{ authorPersonId: 'B', sourceTimestamp: DATE_X }],
        }),
        makeBlock({
          id: 'block4',
          signalType: 'plan_item',
          name: 'План без автора',
          trustedAnswer: 'План без автора',
          evidence: [{ authorPersonId: null, sourceTimestamp: DATE_X }],
        }),
      ],
      persons: [
        { id: 'A', timezone: 'Europe/Moscow' },
        { id: 'B', timezone: 'Europe/Moscow' },
      ],
    });

    const result = await svc.collectForDay({ tenantId: TENANT, dateLocal: DATE_X_LOCAL });

    const a = result.find((r) => r.personId === 'A');
    const b = result.find((r) => r.personId === 'B');

    expect(a).toEqual(
      expect.objectContaining({
        personId: 'A',
        dateLocal: DATE_X_LOCAL,
        plans: [expect.objectContaining({ blockId: 'block1' })],
        dones: [expect.objectContaining({ blockId: 'block2' })],
        blockers: [],
        ideas: [],
      }),
    );
    expect(a?.plans).toHaveLength(1);
    expect(a?.dones).toHaveLength(1);

    expect(b).toEqual(
      expect.objectContaining({
        personId: 'B',
        ideas: [expect.objectContaining({ blockId: 'block3' })],
        plans: [],
        dones: [],
        blockers: [],
      }),
    );

    expect(metrics.incDayReportBlockDroppedNoPerson).toHaveBeenCalled();
  });

  it('дедуплицирует пункты одного ведра по нормализованному тексту', async () => {
    const { svc } = makeService({
      blocks: [
        makeBlock({
          id: 'dup1',
          signalType: 'plan_item',
          name: 'x',
          trustedAnswer: 'Сделать отчёт',
          evidence: [{ authorPersonId: 'A', sourceTimestamp: DATE_X }],
        }),
        makeBlock({
          id: 'dup2',
          signalType: 'plan_item',
          name: 'x',
          trustedAnswer: '  СДЕЛАТЬ Отчёт  ',
          evidence: [{ authorPersonId: 'A', sourceTimestamp: DATE_X }],
        }),
      ],
      persons: [{ id: 'A', timezone: 'Europe/Moscow' }],
    });

    const result = await svc.collectForDay({ tenantId: TENANT, dateLocal: DATE_X_LOCAL });
    const a = result.find((r) => r.personId === 'A');

    expect(a?.plans).toHaveLength(1);
    expect(a?.plans[0]).toEqual(expect.objectContaining({ blockId: 'dup1' }));
  });

  it('фильтрует по personIds', async () => {
    const { svc } = makeService({
      blocks: [
        makeBlock({
          id: 'block1',
          signalType: 'plan_item',
          name: 'План A',
          trustedAnswer: 'План A',
          evidence: [{ authorPersonId: 'A', sourceTimestamp: DATE_X }],
        }),
        makeBlock({
          id: 'block3',
          signalType: 'idea',
          name: 'Идея B',
          trustedAnswer: 'Идея B',
          evidence: [{ authorPersonId: 'B', sourceTimestamp: DATE_X }],
        }),
      ],
      persons: [
        { id: 'A', timezone: 'Europe/Moscow' },
        { id: 'B', timezone: 'Europe/Moscow' },
      ],
    });

    const result = await svc.collectForDay({
      tenantId: TENANT,
      dateLocal: DATE_X_LOCAL,
      personIds: ['A'],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.personId).toBe('A');
    expect(result.find((r) => r.personId === 'B')).toBeUndefined();
  });

  describe('computeNotDone', () => {
    it('план без совпадения в dones, verify done=false → 1 пункт notDone', async () => {
      const verify = vi.fn().mockResolvedValue({
        done: false,
        confidence: 0.8,
        rationale: 'Не завершено.',
        positiveSignals: [],
        negativeSignals: ['не закрыто'],
      });
      const { svc, closureVerifier } = makeService({
        blocks: [],
        persons: [],
        verify,
      });

      const notDone = await svc.computeNotDone({
        tenantId: TENANT,
        raw: makeRaw({ plans: [{ text: 'дожать договор', blockId: 'b1' }] }),
      });

      expect(notDone).toHaveLength(1);
      expect(notDone[0]).toEqual(
        expect.objectContaining({
          text: 'дожать договор',
          sourcePlanText: 'дожать договор',
          verdictConfidence: 0.8,
        }),
      );
      expect(closureVerifier.verify).toHaveBeenCalledTimes(1);
    });

    it('verify done=true (нет точного совпадения) → notDone пуст', async () => {
      const verify = vi.fn().mockResolvedValue({
        done: true,
        confidence: 0.9,
        rationale: 'Сделано.',
        positiveSignals: ['созвонился'],
        negativeSignals: [],
      });
      const { svc, closureVerifier } = makeService({
        blocks: [],
        persons: [],
        verify,
      });

      const notDone = await svc.computeNotDone({
        tenantId: TENANT,
        raw: makeRaw({
          plans: [{ text: 'позвонить клиенту', blockId: 'b1' }],
          dones: [{ text: 'созвонился с заказчиком', blockId: 'b2' }],
        }),
      });

      expect(notDone).toHaveLength(0);
      expect(closureVerifier.verify).toHaveBeenCalledTimes(1);
    });

    it('точное совпадение плана в dones → verify НЕ вызван, notDone пуст', async () => {
      const { svc, closureVerifier, metrics } = makeService({
        blocks: [],
        persons: [],
      });

      const notDone = await svc.computeNotDone({
        tenantId: TENANT,
        raw: makeRaw({
          plans: [{ text: '  Дожать Договор ', blockId: 'b1' }],
          dones: [{ text: 'дожать договор', blockId: 'b2' }],
        }),
      });

      expect(notDone).toHaveLength(0);
      expect(closureVerifier.verify).not.toHaveBeenCalled();
      expect(metrics.incDayReportNotDoneVerifyCalls).not.toHaveBeenCalled();
    });

    it('пустой план дня → notDone пуст, verify не вызван', async () => {
      const { svc, closureVerifier } = makeService({ blocks: [], persons: [] });

      const notDone = await svc.computeNotDone({
        tenantId: TENANT,
        raw: makeRaw({ plans: [] }),
      });

      expect(notDone).toEqual([]);
      expect(closureVerifier.verify).not.toHaveBeenCalled();
    });
  });
});
