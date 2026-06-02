import { UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { InferredTableSchema } from './table-agent.service';
import type { TableAgentService } from './table-agent.service';
import { TableImportService, parseNumericLoose } from './table-import.service';
import type { TablePropertiesService } from './table-properties.service';
import type { TableRowsService } from './table-rows.service';
import type { TablesService } from './tables.service';

/**
 * Unit-тесты `TableImportService` (Smart-tables Фаза 4, Document-to-Table,
 * фиксы багов Фазы 4).
 *
 * Покрываем:
 *  - coerce чисел через commitMerge → перехват cells в rows.createMany;
 *  - checkbox неизвестное значение → строка (не Boolean);
 *  - merge с дублем имён колонок → второй дубль не перетирает первый;
 *  - анти-обход лимита строк: current+new > maxRowsPerTable → 422.
 *
 * coerce и materializeRows — приватные, поэтому проверяем их эффект через
 * публичный commitMerge: захватываем аргумент `rows.createMany({ rows })`.
 */
describe('TableImportService — фиксы Фазы 4', () => {
  const TENANT = 'org-1';
  const USER = 'user-1';
  const TABLE = 'tbl-1';

  let prisma: PrismaService;
  let tables: TablesService;
  let properties: TablePropertiesService;
  let rows: TableRowsService;
  let agent: TableAgentService;
  let cfg: TypedConfigService;
  let svc: TableImportService;

  // моки-функции, к которым обращаемся в assert'ах
  let countFn: ReturnType<typeof vi.fn>;
  let createManyFn: ReturnType<typeof vi.fn>;
  let listFn: ReturnType<typeof vi.fn>;
  let linkFn: ReturnType<typeof vi.fn>;

  /** Целевые колонки таблицы (id ↔ name). По умолчанию — без дублей имён. */
  function setTargetProps(props: Array<{ id: string; name: string }>): void {
    listFn.mockResolvedValue(props);
  }

  /** Захватывает cells первой созданной строки. */
  function capturedRows(): Array<{
    cells: Record<string, unknown>;
    entityId?: string | null;
  }> {
    const arg = createManyFn.mock.calls[0]?.[0] as
      | { rows: Array<{ cells: Record<string, unknown>; entityId?: string | null }> }
      | undefined;
    return arg?.rows ?? [];
  }

  beforeEach(() => {
    countFn = vi.fn().mockResolvedValue(0);
    createManyFn = vi.fn().mockResolvedValue({ created: 1 });
    listFn = vi.fn();
    linkFn = vi
      .fn()
      .mockResolvedValue({ entityIds: [null], linkedCount: 0 });

    prisma = {
      tableRow: { count: countFn },
    } as unknown as PrismaService;

    tables = {
      findById: vi
        .fn()
        .mockResolvedValue({ id: TABLE, entitySync: null }),
    } as unknown as TablesService;

    properties = { list: listFn } as unknown as TablePropertiesService;
    rows = { createMany: createManyFn } as unknown as TableRowsService;
    agent = { linkRowsToEntities: linkFn } as unknown as TableAgentService;
    cfg = {
      smartTables: { maxRowsPerTable: 5000 },
    } as unknown as TypedConfigService;

    svc = new TableImportService(prisma, tables, properties, rows, agent, cfg);
  });

  // ─────────────────────── parseNumericLoose (хелпер) ──────────────────────

  describe('parseNumericLoose', () => {
    it('«1 234,56» → 1234.56 (запятая — десятичный)', () => {
      expect(parseNumericLoose('1 234,56')).toBe(1234.56);
    });
    it('«1,234.56» → 1234.56 (точка — десятичный)', () => {
      expect(parseNumericLoose('1,234.56')).toBe(1234.56);
    });
    it('«15%» → 15 (процент без деления)', () => {
      expect(parseNumericLoose('15%')).toBe(15);
    });
    it('«$1 200» → 1200 (валюта + пробел-группировка)', () => {
      expect(parseNumericLoose('$1 200')).toBe(1200);
    });
    it('«$1,200.00» → 1200 (точка — десятичный, запятая — группировка)', () => {
      expect(parseNumericLoose('$1,200.00')).toBe(1200);
    });
    // ВНИМАНИЕ — фундаментальная неоднозначность: «1,200» неотличимо от «1.2».
    // Алгоритм (по ТЗ) трактует последнюю запятую как десятичный разделитель,
    // поэтому «$1,200» → 1.2 (а не 1200). Это документированное поведение
    // verbatim-хелпера, а не баг: без локали разрешить «1,200» однозначно нельзя.
    it('«$1,200» → 1.2 (запятая трактуется как десятичный — неоднозначность)', () => {
      expect(parseNumericLoose('$1,200')).toBe(1.2);
    });
    it('мусор → null', () => {
      expect(parseNumericLoose('не число')).toBeNull();
      expect(parseNumericLoose('')).toBeNull();
    });
  });

  // ─────────────────────── coerce через commitMerge ────────────────────────

  it('coerce чисел: «1 234,56»→1234.56, «1,234.56»→1234.56, «15%»→15, «$1 200»→1200, мусор→строка', async () => {
    setTargetProps([
      { id: 'p-num', name: 'Число' },
      { id: 'p-cur', name: 'Сумма' },
      { id: 'p-pct', name: 'Процент' },
      { id: 'p-cur2', name: 'Цена' },
      { id: 'p-bad', name: 'Битое' },
    ]);
    linkFn.mockResolvedValue({ entityIds: [null], linkedCount: 0 });

    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [
        { name: 'Число', type: 'number', isPrimary: true },
        { name: 'Сумма', type: 'currency', isPrimary: false },
        { name: 'Процент', type: 'percent', isPrimary: false },
        { name: 'Цена', type: 'currency', isPrimary: false },
        { name: 'Битое', type: 'number', isPrimary: false },
      ],
    };

    await svc.commitMerge({
      tenantId: TENANT,
      userId: USER,
      targetTableId: TABLE,
      schema,
      // «$1 200» — пробел-группировка (однозначно 1200, в отличие от «$1,200»).
      rows: [['1 234,56', '1,234.56', '15%', '$1 200', 'не число']],
    });

    const cells = capturedRows()[0]?.cells ?? {};
    expect(cells['p-num']).toBe(1234.56);
    expect(cells['p-cur']).toBe(1234.56);
    expect(cells['p-pct']).toBe(15);
    expect(cells['p-cur2']).toBe(1200);
    // Непарсящееся — graceful, остаётся строкой.
    expect(cells['p-bad']).toBe('не число');
  });

  it('checkbox: неизвестное значение → исходная строка (не true/false)', async () => {
    setTargetProps([{ id: 'p-cb', name: 'Флаг' }]);
    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [{ name: 'Флаг', type: 'checkbox', isPrimary: true }],
    };

    await svc.commitMerge({
      tenantId: TENANT,
      userId: USER,
      targetTableId: TABLE,
      schema,
      rows: [['может быть']],
    });

    expect(capturedRows()[0]?.cells['p-cb']).toBe('может быть');
  });

  it('checkbox: известные значения → true/false', async () => {
    setTargetProps([{ id: 'p-cb', name: 'Флаг' }]);
    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [{ name: 'Флаг', type: 'checkbox', isPrimary: true }],
    };

    linkFn.mockResolvedValue({ entityIds: [null, null], linkedCount: 0 });
    await svc.commitMerge({
      tenantId: TENANT,
      userId: USER,
      targetTableId: TABLE,
      schema,
      rows: [['да'], ['нет']],
    });

    const all = capturedRows();
    expect(all[0]?.cells['p-cb']).toBe(true);
    expect(all[1]?.cells['p-cb']).toBe(false);
  });

  // ─────────────────────── merge: дубли имён колонок ───────────────────────

  it('merge с дублем имён: второй столбец-дубль НЕ перетирает первый', async () => {
    // У целевой таблицы две колонки, но схема файла содержит ДВА столбца с одним
    // именем «Сумма». Оба должны мапиться на один propertyId — но только первый.
    setTargetProps([
      { id: 'p-name', name: 'Название' },
      { id: 'p-sum', name: 'Сумма' },
    ]);

    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [
        { name: 'Название', type: 'text', isPrimary: true },
        { name: 'Сумма', type: 'number', isPrimary: false },
        { name: 'Сумма', type: 'number', isPrimary: false }, // дубль имени
      ],
    };

    await svc.commitMerge({
      tenantId: TENANT,
      userId: USER,
      targetTableId: TABLE,
      schema,
      rows: [['ООО Ромашка', '100', '999']],
    });

    const cells = capturedRows()[0]?.cells ?? {};
    // p-sum получил значение ПЕРВОГО столбца «Сумма» (100), не второго (999).
    expect(cells['p-sum']).toBe(100);
    expect(cells['p-name']).toBe('ООО Ромашка');
  });

  // ─────────────────────── анти-обход лимита строк ─────────────────────────

  it('лимит строк: current+new > maxRowsPerTable → 422 table_rows_limit_exceeded', async () => {
    setTargetProps([{ id: 'p-name', name: 'Название' }]);
    // лимит 5000, уже есть 4999, импортируем 2 → 5001 > 5000.
    countFn.mockResolvedValue(4999);

    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [{ name: 'Название', type: 'text', isPrimary: true }],
    };

    await expect(
      svc.commitMerge({
        tenantId: TENANT,
        userId: USER,
        targetTableId: TABLE,
        schema,
        rows: [['A'], ['B']],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // Строки не вставлялись — проверка отсекла до createMany.
    expect(createManyFn).not.toHaveBeenCalled();
  });

  it('лимит строк: current+new ровно = лимиту → проходит', async () => {
    setTargetProps([{ id: 'p-name', name: 'Название' }]);
    countFn.mockResolvedValue(4998);
    linkFn.mockResolvedValue({ entityIds: [null, null], linkedCount: 0 });

    const schema: InferredTableSchema = {
      name: 'Тест',
      description: null,
      icon: null,
      entitySync: null,
      properties: [{ name: 'Название', type: 'text', isPrimary: true }],
    };

    const res = await svc.commitMerge({
      tenantId: TENANT,
      userId: USER,
      targetTableId: TABLE,
      schema,
      rows: [['A'], ['B']], // 4998 + 2 = 5000 = лимит → ок
    });

    expect(createManyFn).toHaveBeenCalledTimes(1);
    expect(res.rowsCreated).toBe(1); // createMany мок вернул { created: 1 }
  });
});
