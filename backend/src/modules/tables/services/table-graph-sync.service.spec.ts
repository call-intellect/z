import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TableGraphSyncService } from './table-graph-sync.service';

describe('TableGraphSyncService', () => {
  const TENANT = 'org-1';

  const GOAL_PROPS = [
    { id: 'p-name', name: 'Формулировка', type: 'longtext', config: {} },
    { id: 'p-metric', name: 'Метрика', type: 'text', config: {} },
    { id: 'p-due', name: 'Срок', type: 'date', config: {} },
  ];
  const PROMISE_PROPS = [
    { id: 'p-what', name: 'Что', type: 'longtext', config: {} },
    { id: 'p-due', name: 'Срок', type: 'date', config: {} },
  ];
  const IDEA_PROPS = [{ id: 'p-form', name: 'Формулировка', type: 'longtext', config: {} }];
  const EXP_PROPS = [
    { id: 'p-form', name: 'Формулировка', type: 'longtext', config: {} },
    { id: 'p-start', name: 'Дата старта', type: 'date', config: {} },
    { id: 'p-result', name: 'Результат', type: 'longtext', config: {} },
  ];

  function goalTable() {
    return {
      id: 't-okr',
      tenantId: TENANT,
      deletedAt: null,
      archivedAt: null,
      graphSync: { source: 'goal', fieldMap: { Формулировка: 'name', Срок: 'targetDate' }, autoCreate: true },
      properties: GOAL_PROPS,
    };
  }
  function promiseTable() {
    return {
      id: 't-promises',
      tenantId: TENANT,
      deletedAt: null,
      archivedAt: null,
      graphSync: {
        source: 'idea_block',
        signalType: 'commitment',
        fieldMap: { Что: 'name', Срок: 'commitmentDueDate' },
        autoCreate: true,
      },
      properties: PROMISE_PROPS,
    };
  }
  function ideaTable() {
    return {
      id: 't-ideas',
      tenantId: TENANT,
      deletedAt: null,
      archivedAt: null,
      graphSync: {
        source: 'idea_block',
        signalType: 'idea',
        fieldMap: { Формулировка: 'name' },
        autoCreate: true,
      },
      properties: IDEA_PROPS,
    };
  }
  function expTable() {
    return {
      id: 't-hyp',
      tenantId: TENANT,
      deletedAt: null,
      archivedAt: null,
      graphSync: {
        source: 'experiment',
        fieldMap: { Формулировка: 'name', 'Дата старта': 'startedAt', Результат: 'currentResult' },
        autoCreate: true,
      },
      properties: EXP_PROPS,
    };
  }

  type Fn = ReturnType<typeof vi.fn>;
  interface PrismaMock {
    table: { findMany: Fn };
    tableRow: { findFirst: Fn; findMany: Fn; create: Fn; update: Fn };
    tableCellProvenance: { create: Fn };
    goal: { findMany: Fn };
    experiment: { findMany: Fn };
    ideaBlock: { findMany: Fn };
  }
  let prisma: PrismaMock;
  let cfg: { getDynamic: Fn };
  let svc: TableGraphSyncService;

  beforeEach(() => {
    prisma = {
      table: { findMany: vi.fn().mockResolvedValue([]) },
      tableRow: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'row-new' }),
        update: vi.fn().mockResolvedValue({ id: 'row-upd' }),
      },
      tableCellProvenance: { create: vi.fn().mockResolvedValue({ id: 'prov-1' }) },
      goal: { findMany: vi.fn().mockResolvedValue([]) },
      experiment: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
    };
    cfg = {
      getDynamic: vi.fn(async (key: string, _e: unknown, fallback: unknown) => {
        if (key === 'table.graphsync.enabled') return true;
        if (key === 'table.graphsync.min_confidence') return 0.6;
        return fallback;
      }),
    };
    svc = new TableGraphSyncService(
      prisma as unknown as PrismaService,
      cfg as unknown as TypedConfigService,
    );
  });

  it('create из Goal: name→Формулировка, targetDate→Срок (ISO), status=active, sourceObjectId, provenance', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);
    const due = new Date('2026-09-01T00:00:00.000Z');

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: { id: 'goal-1', name: 'Вырасти на 30%', targetDate: due, confidence: new Prisma.Decimal(0.9) },
    });

    expect(res).toBe('created');
    expect(prisma.tableRow.create).toHaveBeenCalledTimes(1);
    const data = prisma.tableRow.create.mock.calls[0]![0].data;
    expect(data.cells['p-name']).toBe('Вырасти на 30%');
    expect(data.cells['p-due']).toBe('2026-09-01T00:00:00.000Z');
    expect(data.status).toBe('active');
    expect(data.sourceObjectType).toBe('goal');
    expect(data.sourceObjectId).toBe('goal-1');
    expect(data.createdBy).toBe('system');
    expect(prisma.tableCellProvenance.create).toHaveBeenCalledTimes(2);
    const prov = prisma.tableCellProvenance.create.mock.calls[0]![0].data;
    expect(prov.sourceType).toBe('goal');
    expect(prov.sourceId).toBe('goal-1');
    expect(prov.appliedBy).toBe('agent');
  });

  it('create из IdeaBlock signalType=commitment → таблица «Обещания» (Что/Срок)', async () => {
    prisma.table.findMany.mockResolvedValue([promiseTable(), ideaTable()]);
    const due = new Date('2026-08-15T00:00:00.000Z');

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'idea_block',
      object: {
        id: 'blk-1',
        name: 'Прислать отчёт',
        signalType: 'commitment',
        commitmentDueDate: due,
        confidence: new Prisma.Decimal(0.9),
      },
    });

    expect(res).toBe('created');
    expect(prisma.tableRow.create).toHaveBeenCalledTimes(1);
    const data = prisma.tableRow.create.mock.calls[0]![0].data;
    expect(data.tableId).toBe('t-promises');
    expect(data.cells['p-what']).toBe('Прислать отчёт');
    expect(data.cells['p-due']).toBe('2026-08-15T00:00:00.000Z');
  });

  it('create из IdeaBlock signalType=idea → таблица «Идеи»', async () => {
    prisma.table.findMany.mockResolvedValue([promiseTable(), ideaTable()]);

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'idea_block',
      object: { id: 'blk-2', name: 'Сделать реферальную программу', signalType: 'idea', confidence: new Prisma.Decimal(0.8) },
    });

    expect(res).toBe('created');
    const data = prisma.tableRow.create.mock.calls[0]![0].data;
    expect(data.tableId).toBe('t-ideas');
    expect(data.cells['p-form']).toBe('Сделать реферальную программу');
  });

  it('create из Experiment → «Гипотезы» (startedAt ISO, currentResult)', async () => {
    prisma.table.findMany.mockResolvedValue([expTable()]);
    const started = new Date('2026-07-01T00:00:00.000Z');

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'experiment',
      object: {
        id: 'exp-1',
        name: 'Новый онбординг поднимет активацию',
        startedAt: started,
        currentResult: 'Активация +12%',
        confidence: new Prisma.Decimal(0.75),
      },
    });

    expect(res).toBe('created');
    const data = prisma.tableRow.create.mock.calls[0]![0].data;
    expect(data.cells['p-form']).toBe('Новый онбординг поднимет активацию');
    expect(data.cells['p-start']).toBe('2026-07-01T00:00:00.000Z');
    expect(data.cells['p-result']).toBe('Активация +12%');
  });

  it('дедуп: второй syncObject того же объекта → updated, новой строки нет', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);
    prisma.tableRow.findFirst.mockResolvedValue({
      id: 'row-existing',
      cells: { 'p-name': 'Вырасти на 30%', 'p-due': '2026-09-01T00:00:00.000Z' },
    });

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: {
        id: 'goal-1',
        name: 'Вырасти на 30%',
        targetDate: new Date('2026-09-01T00:00:00.000Z'),
        confidence: new Prisma.Decimal(0.9),
      },
    });

    expect(res).toBe('updated');
    expect(prisma.tableRow.create).not.toHaveBeenCalled();
    expect(prisma.tableRow.update).not.toHaveBeenCalled();
  });

  it('гейт: confidence < min_confidence → skipped, строка не создаётся', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: { id: 'goal-low', name: 'Слабая цель', confidence: new Prisma.Decimal(0.3) },
    });

    expect(res).toBe('skipped');
    expect(prisma.tableRow.create).not.toHaveBeenCalled();
  });

  it('confidence null (ручной объект) → created (эфф. 1.0)', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: { id: 'goal-manual', name: 'Ручная цель', confidence: null },
    });

    expect(res).toBe('created');
    expect(prisma.tableRow.create).toHaveBeenCalledTimes(1);
  });

  it('анти-clobber: непустая целевая ячейка не перетирается', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);
    prisma.tableRow.findFirst.mockResolvedValue({
      id: 'row-existing',
      cells: { 'p-name': 'Правка руками' },
    });

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: {
        id: 'goal-1',
        name: 'Из графа',
        targetDate: new Date('2026-09-01T00:00:00.000Z'),
        confidence: new Prisma.Decimal(0.9),
      },
    });

    expect(res).toBe('updated');
    expect(prisma.tableRow.update).toHaveBeenCalledTimes(1);
    const merged = prisma.tableRow.update.mock.calls[0]![0].data.cells;
    expect(merged['p-name']).toBe('Правка руками');
    expect(merged['p-due']).toBe('2026-09-01T00:00:00.000Z');
    const provKeys = prisma.tableCellProvenance.create.mock.calls.map(
      (c) => (c[0] as { data: { propertyId: string } }).data.propertyId,
    );
    expect(provKeys).toEqual(['p-due']);
  });

  it('kill-switch enabled=false → skipped, ничего не пишет', async () => {
    cfg.getDynamic.mockImplementation(async (key: string, _e: unknown, fallback: unknown) => {
      if (key === 'table.graphsync.enabled') return false;
      return fallback;
    });
    prisma.table.findMany.mockResolvedValue([goalTable()]);

    const res = await svc.syncObject({
      tenantId: TENANT,
      source: 'goal',
      object: { id: 'goal-1', name: 'Цель', confidence: new Prisma.Decimal(0.9) },
    });

    expect(res).toBe('skipped');
    expect(prisma.table.findMany).not.toHaveBeenCalled();
    expect(prisma.tableRow.create).not.toHaveBeenCalled();
  });

  it('reconcileTenant идемпотентен: второй проход при существующих строках → 0 created', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);
    prisma.goal.findMany.mockResolvedValue([
      { id: 'goal-1', name: 'Цель А', targetDate: null, confidence: new Prisma.Decimal(0.9) },
    ]);
    prisma.tableRow.findFirst.mockResolvedValue({
      id: 'row-existing',
      cells: { 'p-name': 'Цель А' },
    });

    const res = await svc.reconcileTenant(TENANT);

    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
    expect(prisma.tableRow.create).not.toHaveBeenCalled();
  });

  it('reconcileTenant создаёт строку для живого Goal при пустой таблице', async () => {
    prisma.table.findMany.mockResolvedValue([goalTable()]);
    prisma.goal.findMany.mockResolvedValue([
      { id: 'goal-1', name: 'Цель А', targetDate: null, confidence: new Prisma.Decimal(0.9) },
    ]);

    const res = await svc.reconcileTenant(TENANT);

    expect(res.created).toBe(1);
    expect(prisma.tableRow.create).toHaveBeenCalledTimes(1);
    expect(prisma.goal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT, archivedAt: null }) }),
    );
  });
});
