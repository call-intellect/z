/**
 * Unit-тесты `applyFilters` (Smart-tables Фаза 5 — NL Saved Views).
 *
 * Покрываем семантику операторов и устойчивость к формам значений ячеек
 * (скаляр / объект статуса `{ id, name }` / массив selectMulti / ISO-дата).
 * `now` параметризуется, чтобы `older_than` был детерминирован.
 */
import { describe, expect, it } from 'vitest';

import { applyFilters, type TableFilterCondition } from './table';

interface Row {
  id: string;
  cells: Record<string, unknown>;
}

// Фиксированная «сейчас»: 2026-06-02T00:00:00Z.
const NOW = Date.parse('2026-06-02T00:00:00.000Z');

const PROPS = [
  { id: 'name', type: 'text' as const },
  { id: 'amount', type: 'number' as const },
  { id: 'status', type: 'status' as const },
  { id: 'tags', type: 'selectMulti' as const },
  { id: 'lastContact', type: 'date' as const },
];

const rows: Row[] = [
  {
    id: 'r1',
    cells: {
      name: 'Альфа',
      amount: 100,
      status: { id: 's1', name: 'Активен' },
      tags: [{ id: 't1', name: 'VIP' }, 'крупный'],
      lastContact: '2026-05-30T10:00:00.000Z', // 3 дня назад
    },
  },
  {
    id: 'r2',
    cells: {
      name: 'Бета',
      amount: 500,
      status: 'Завершён',
      tags: ['малый'],
      lastContact: '2026-04-01T10:00:00.000Z', // ~62 дня назад
    },
  },
  {
    id: 'r3',
    cells: {
      name: 'Гамма',
      amount: 0,
      status: null,
      tags: [],
      lastContact: '', // пусто
    },
  },
];

function run(...filters: TableFilterCondition[]): string[] {
  return applyFilters(rows, filters, PROPS, NOW).map((r) => r.id);
}

describe('applyFilters', () => {
  it('пустой фильтр возвращает все строки', () => {
    expect(applyFilters(rows, undefined, PROPS, NOW).map((r) => r.id)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
    expect(run()).toEqual(['r1', 'r2', 'r3']);
  });

  it('contains — подстрока, case-insensitive', () => {
    expect(run({ propertyId: 'name', op: 'contains', value: 'ам' })).toEqual([
      'r3',
    ]);
  });

  it('gt / lt — числовое сравнение', () => {
    expect(run({ propertyId: 'amount', op: 'gt', value: 100 })).toEqual(['r2']);
    expect(run({ propertyId: 'amount', op: 'lt', value: 100 })).toEqual(['r3']);
  });

  it('ФИКС 4: gt по ячейке-строке ru-RU («1 234,56») парсится в число', () => {
    const ruRows: Row[] = [
      { id: 'a', cells: { amount: '1 234,56' } }, // 1234.56 (пробел=разряды, запятая=дробь)
      { id: 'b', cells: { amount: '999,00' } }, // 999.00
    ];
    const out = applyFilters(
      ruRows,
      [{ propertyId: 'amount', op: 'gt', value: 1000 }],
      PROPS,
      NOW,
    ).map((r) => r.id);
    expect(out).toEqual(['a']);
  });

  it('eq / neq — по объекту статуса сравнивает name', () => {
    expect(run({ propertyId: 'status', op: 'eq', value: 'Активен' })).toEqual([
      'r1',
    ]);
    // ФИКС 7: r3 со status:null (пустая ячейка) НЕ проходит neq — пустое
    // значение не участвует в «равно/не равно X». Остаётся только r2.
    expect(run({ propertyId: 'status', op: 'neq', value: 'Активен' })).toEqual([
      'r2',
    ]);
  });

  it('ФИКС 7: eq/neq на пустой ячейке не проходят (ни true, ни false)', () => {
    // У r3 status пуст: и eq, и neq по нему дают false → r3 не попадает.
    expect(run({ propertyId: 'status', op: 'eq', value: 'Активен' })).not.toContain(
      'r3',
    );
    expect(
      run({ propertyId: 'status', op: 'neq', value: 'Активен' }),
    ).not.toContain('r3');
  });

  it('ФИКС 3: eq/neq по date-колонке сравнивает по календарному дню (UTC)', () => {
    // r1.lastContact = 2026-05-30T10:00:00Z. eq по «голой» дате того же дня
    // (без времени) должен совпасть, несмотря на разное время суток.
    expect(
      run({ propertyId: 'lastContact', op: 'eq', value: '2026-05-30' }),
    ).toEqual(['r1']);
    // neq по тому же дню исключает r1; r3 с пустой датой не участвует (ФИКС 7).
    expect(
      run({ propertyId: 'lastContact', op: 'neq', value: '2026-05-30' }),
    ).toEqual(['r2']);
  });

  it('in — membership по селект-мульти (объекты + строки)', () => {
    expect(
      run({ propertyId: 'tags', op: 'in', value: ['VIP', 'малый'] }),
    ).toEqual(['r1', 'r2']);
  });

  it('empty — пустая ячейка (null / "" / [])', () => {
    expect(run({ propertyId: 'status', op: 'empty' })).toEqual(['r3']);
    expect(run({ propertyId: 'tags', op: 'empty' })).toEqual(['r3']);
    expect(run({ propertyId: 'lastContact', op: 'empty' })).toEqual(['r3']);
  });

  it('before / after — сравнение дат', () => {
    expect(
      run({
        propertyId: 'lastContact',
        op: 'before',
        value: '2026-05-01T00:00:00.000Z',
      }),
    ).toEqual(['r2']);
    expect(
      run({
        propertyId: 'lastContact',
        op: 'after',
        value: '2026-05-01T00:00:00.000Z',
      }),
    ).toEqual(['r1']);
  });

  it('older_than — дата старше N дней назад', () => {
    // 30 дней назад от NOW = 2026-05-03. Старше — только r2 (апрель).
    expect(
      run({ propertyId: 'lastContact', op: 'older_than', value: 30 }),
    ).toEqual(['r2']);
  });

  it('AND — все условия должны выполняться', () => {
    expect(
      run(
        { propertyId: 'amount', op: 'gt', value: 50 },
        { propertyId: 'status', op: 'eq', value: 'Активен' },
      ),
    ).toEqual(['r1']);
  });

  it('условие по несуществующей колонке игнорируется (фильтр не роняется)', () => {
    expect(run({ propertyId: 'missing', op: 'eq', value: 'x' })).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });

  it('непарсимое значение под оператор — строка не проходит условие', () => {
    // gt по тексту, который не число и не дата → ни одна строка не проходит.
    expect(run({ propertyId: 'name', op: 'gt', value: 10 })).toEqual([]);
  });
});
