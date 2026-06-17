import { describe, expect, it, vi } from 'vitest';

import { OperationsDashboardService } from './operations-dashboard.service';

type Group = { personId: string; kind: string; _count: { _all: number } };

function buildSvc(opts: {
  enabled: boolean;
  expected?: Group[];
  completed?: Group[];
  persons?: Array<{ id: string; name: string }>;
}) {
  const groupBy = vi
    .fn()
    .mockResolvedValueOnce(opts.expected ?? [])
    .mockResolvedValueOnce(opts.completed ?? []);
  const personFindMany = vi.fn().mockResolvedValue(opts.persons ?? []);

  const prisma = {
    dailyCheckIn: { groupBy },
    person: { findMany: personFindMany },
  };
  const cfg = {
    betaOps: { dailyCheckInEnabled: opts.enabled },
  };
  const metrics = {};

  const svc = new OperationsDashboardService(prisma as never, cfg as never, metrics as never);
  return { svc, groupBy, personFindMany };
}

const g = (personId: string, kind: string, n: number): Group => ({
  personId,
  kind,
  _count: { _all: n },
});

describe('OperationsDashboardService.getCheckinDiscipline', () => {
  it('(а) обычные данные: утро/вечер сдано/пропущено → totals + byPerson', async () => {
    const { svc } = buildSvc({
      enabled: true,
      expected: [
        g('p-anna', 'morning', 5),
        g('p-anna', 'evening', 5),
        g('p-boris', 'morning', 5),
        g('p-boris', 'evening', 5),
      ],
      completed: [
        g('p-anna', 'morning', 4),
        g('p-anna', 'evening', 3),
        g('p-boris', 'morning', 5),
        g('p-boris', 'evening', 0),
      ],
      persons: [
        { id: 'p-anna', name: 'Анна' },
        { id: 'p-boris', name: 'Борис' },
      ],
    });

    const dto = await svc.getCheckinDiscipline({
      tenantId: 't1',
      from: '2026-06-08',
      to: '2026-06-12',
    });

    expect(dto.enabled).toBe(true);
    expect(dto.from).toBe('2026-06-08');
    expect(dto.to).toBe('2026-06-12');

    expect(dto.totals.morningExpected).toBe(10);
    expect(dto.totals.morningCompleted).toBe(9);
    expect(dto.totals.morningMissed).toBe(1);
    expect(dto.totals.eveningExpected).toBe(10);
    expect(dto.totals.eveningCompleted).toBe(3);
    expect(dto.totals.eveningMissed).toBe(7);
    expect(dto.totals.completionRate).toBe(0.6);

    expect(dto.byPerson).toHaveLength(2);
    const anna = dto.byPerson.find((p) => p.personId === 'p-anna')!;
    expect(anna.personName).toBe('Анна');
    expect(anna.morningExpected).toBe(5);
    expect(anna.morningCompleted).toBe(4);
    expect(anna.morningMissed).toBe(1);
    expect(anna.eveningExpected).toBe(5);
    expect(anna.eveningCompleted).toBe(3);
    expect(anna.eveningMissed).toBe(2);
    expect(anna.completionRate).toBe(0.7);

    const boris = dto.byPerson.find((p) => p.personId === 'p-boris')!;
    expect(boris.morningCompleted).toBe(5);
    expect(boris.eveningCompleted).toBe(0);
    expect(boris.eveningMissed).toBe(5);
    expect(boris.completionRate).toBe(0.5);
  });

  it('(б) нет данных → totals нули, completionRate=null, byPerson пуст', async () => {
    const { svc, personFindMany } = buildSvc({
      enabled: true,
      expected: [],
      completed: [],
    });

    const dto = await svc.getCheckinDiscipline({
      tenantId: 't1',
      from: '2026-06-08',
      to: '2026-06-12',
    });

    expect(dto.enabled).toBe(true);
    expect(dto.byPerson).toEqual([]);
    expect(dto.totals.morningExpected).toBe(0);
    expect(dto.totals.morningCompleted).toBe(0);
    expect(dto.totals.morningMissed).toBe(0);
    expect(dto.totals.eveningExpected).toBe(0);
    expect(dto.totals.eveningCompleted).toBe(0);
    expect(dto.totals.eveningMissed).toBe(0);
    expect(dto.totals.completionRate).toBeNull();
    expect(personFindMany).not.toHaveBeenCalled();
  });

  it('(в) флаг DAILY_CHECKIN_ENABLED=false → enabled:false, нулевые totals, groupBy не вызван', async () => {
    const { svc, groupBy } = buildSvc({ enabled: false });

    const dto = await svc.getCheckinDiscipline({
      tenantId: 't1',
      from: '2026-06-08',
      to: '2026-06-12',
    });

    expect(dto.enabled).toBe(false);
    expect(dto.from).toBe('2026-06-08');
    expect(dto.to).toBe('2026-06-12');
    expect(dto.byPerson).toEqual([]);
    expect(dto.totals.completionRate).toBeNull();
    expect(dto.totals.morningExpected).toBe(0);
    expect(dto.totals.eveningExpected).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('детерминизм: при отсутствии имени Person → «Без имени», порядок по expected desc', async () => {
    const { svc } = buildSvc({
      enabled: true,
      expected: [g('p-low', 'morning', 1), g('p-high', 'morning', 9)],
      completed: [g('p-high', 'morning', 9)],
      persons: [{ id: 'p-high', name: 'Главный' }],
    });

    const dto = await svc.getCheckinDiscipline({
      tenantId: 't1',
      from: '2026-06-08',
      to: '2026-06-12',
    });

    expect(dto.byPerson[0]!.personId).toBe('p-high');
    expect(dto.byPerson[1]!.personId).toBe('p-low');
    expect(dto.byPerson[1]!.personName).toBe('Без имени');
  });
});
