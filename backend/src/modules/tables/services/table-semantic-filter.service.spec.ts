import { NotFoundException } from '@nestjs/common';
import type { TablePropType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  cellMatchesCondition,
  isOpCompatible,
  rowMatchesConditions,
  validateFilters,
  type TableFilterCondition,
} from '../dto/table-filter.dto';

import { TableSemanticFilterService } from './table-semantic-filter.service';

describe('TableSemanticFilterService', () => {
  const TENANT = 'org-1';
  const TABLE = 'tbl-1';

  const PROPS = [
    { id: 'p-name', name: 'Название', type: 'text' as TablePropType },
    { id: 'p-last', name: 'Последний контакт', type: 'date' as TablePropType },
    { id: 'p-amount', name: 'Сумма', type: 'currency' as TablePropType },
    { id: 'p-status', name: 'Статус', type: 'status' as TablePropType },
  ];

  let call: ReturnType<typeof vi.fn>;
  let redisGet: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let llm: LlmRouterService;
  let prisma: PrismaService;
  let redis: RedisService;
  let svc: TableSemanticFilterService;

  function reply(obj: unknown) {
    return {
      text: JSON.stringify(obj),
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    };
  }

  beforeEach(() => {
    call = vi.fn();
    redisGet = vi.fn().mockResolvedValue(null);
    redisSet = vi.fn().mockResolvedValue('OK');
    findUnique = vi.fn().mockResolvedValue({
      tenantId: TENANT,
      deletedAt: null,
      properties: PROPS,
    });

    llm = { call } as unknown as LlmRouterService;
    prisma = {
      table: { findUnique },
    } as unknown as PrismaService;
    redis = {
      client: { get: redisGet, set: redisSet },
    } as unknown as RedisService;

    svc = new TableSemanticFilterService(llm, prisma, redis);
  });

  it('(a) cache miss: LLM → валидный фильтр → валидируется и кэшируется', async () => {
    call.mockResolvedValueOnce(
      reply({
        filters: [
          { propertyId: 'p-last', op: 'older_than', value: 30 },
          { propertyId: 'p-amount', op: 'gt', value: 100000 },
        ],
      }),
    );

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'клиенты, кому месяц не писали и сумма больше 100к',
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(out.cached).toBe(false);
    expect(out.filters).toEqual([
      { propertyId: 'p-last', op: 'older_than', value: 30 },
      { propertyId: 'p-amount', op: 'gt', value: 100000 },
    ]);
    expect(redisSet).toHaveBeenCalledTimes(1);
    const setArgs = redisSet.mock.calls[0] as [string, string, string, number];
    expect(setArgs[0]).toMatch(/^table:semfilter:tbl-1:[0-9a-f]{40}$/);
    expect(setArgs[2]).toBe('EX');
    expect(setArgs[3]).toBe(604_800);
  });

  it('(b) cache hit: redis.get вернул JSON → LLM НЕ вызывается, cached:true', async () => {
    redisGet.mockResolvedValueOnce(
      JSON.stringify([{ propertyId: 'p-status', op: 'in', value: ['active'] }]),
    );

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'активные клиенты',
    });

    expect(call).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    expect(out.cached).toBe(true);
    expect(out.filters).toEqual([{ propertyId: 'p-status', op: 'in', value: ['active'] }]);
  });

  it('(b2) ФИКС 6: кэш ревалидируется в пустой (протух) → НЕ cached, идём в LLM', async () => {
    redisGet.mockResolvedValueOnce(
      JSON.stringify([{ propertyId: 'p-removed', op: 'eq', value: 'x' }]),
    );
    call.mockResolvedValueOnce(
      reply({ filters: [{ propertyId: 'p-name', op: 'contains', value: 'ООО' }] }),
    );

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'клиенты ООО',
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(out.cached).toBe(false);
    expect(out.filters).toEqual([{ propertyId: 'p-name', op: 'contains', value: 'ООО' }]);
  });

  it('(c) валидатор: несуществующий propertyId / несовместимый op / кривой value отброшены', async () => {
    call.mockResolvedValueOnce(
      reply({
        filters: [
          { propertyId: 'p-nope', op: 'eq', value: 'x' },
          { propertyId: 'p-amount', op: 'contains', value: 'x' },
          { propertyId: 'p-last', op: 'older_than', value: 'вчера' },
          { propertyId: 'p-name', op: 'contains', value: 'ООО' },
        ],
      }),
    );

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'разный мусор и одно валидное',
    });

    expect(out.filters).toEqual([{ propertyId: 'p-name', op: 'contains', value: 'ООО' }]);
  });

  it('(d) LLM вернул не-JSON → {filters:[]} без краха, кэш не пишется', async () => {
    call.mockResolvedValueOnce({
      text: 'извините, не понял запрос',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    });

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'бла бла',
    });

    expect(out.filters).toEqual([]);
    expect(out.cached).toBe(false);
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('(d2) LLM call бросает → {filters:[]} без краха', async () => {
    call.mockRejectedValueOnce(new Error('provider down'));
    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'что угодно',
    });
    expect(out.filters).toEqual([]);
    expect(out.cached).toBe(false);
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('чужой tenant / удалённая таблица → NotFoundException', async () => {
    findUnique.mockResolvedValueOnce({
      tenantId: 'other-org',
      deletedAt: null,
      properties: PROPS,
    });
    await expect(
      svc.parseSemanticFilter({
        tenantId: TENANT,
        tableId: TABLE,
        nlQuery: 'клиенты',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(call).not.toHaveBeenCalled();
  });

  it('нормализованный запрос даёт тот же ключ кэша (trim/case/whitespace)', async () => {
    call.mockResolvedValue(reply({ filters: [] }));
    await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: '  Активные   Клиенты  ',
    });
    const keyA = (redisGet.mock.calls[0] as [string])[0];

    redisGet.mockClear();
    await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'активные клиенты',
    });
    const keyB = (redisGet.mock.calls[0] as [string])[0];

    expect(keyA).toBe(keyB);
  });
});

describe('validateFilters (таблица совместимости op×type)', () => {
  const props = [
    { id: 'text', type: 'text' as TablePropType },
    { id: 'num', type: 'number' as TablePropType },
    { id: 'date', type: 'date' as TablePropType },
    { id: 'sel', type: 'selectSingle' as TablePropType },
    { id: 'chk', type: 'checkbox' as TablePropType },
    { id: 'rel', type: 'relation' as TablePropType },
  ];

  function keep(filters: TableFilterCondition[]) {
    return validateFilters(filters, props).map((f) => `${f.propertyId}:${f.op}`);
  }

  it('eq/neq/empty универсальны для любого типа', () => {
    expect(
      keep([
        { propertyId: 'text', op: 'eq', value: 'x' },
        { propertyId: 'num', op: 'neq', value: 5 },
        { propertyId: 'rel', op: 'empty' },
        { propertyId: 'chk', op: 'eq', value: true },
      ]),
    ).toEqual(['text:eq', 'num:neq', 'rel:empty', 'chk:eq']);
  });

  it('contains только для текстовых типов', () => {
    expect(isOpCompatible('contains', 'text')).toBe(true);
    expect(isOpCompatible('contains', 'number')).toBe(false);
    expect(
      keep([
        { propertyId: 'text', op: 'contains', value: 'x' },
        { propertyId: 'num', op: 'contains', value: 'x' },
      ]),
    ).toEqual(['text:contains']);
  });

  it('gt/lt только для number/currency/percent/date', () => {
    expect(isOpCompatible('gt', 'number')).toBe(true);
    expect(isOpCompatible('lt', 'date')).toBe(true);
    expect(isOpCompatible('gt', 'text')).toBe(false);
    expect(
      keep([
        { propertyId: 'num', op: 'gt', value: 10 },
        { propertyId: 'date', op: 'lt', value: '2026-01-01' },
        { propertyId: 'text', op: 'gt', value: 5 },
      ]),
    ).toEqual(['num:gt', 'date:lt']);
  });

  it('before/after/older_than только для date с корректным value', () => {
    expect(
      keep([
        { propertyId: 'date', op: 'before', value: '2026-05-01' },
        { propertyId: 'date', op: 'after', value: '2026-01-01' },
        { propertyId: 'date', op: 'older_than', value: 30 },
        { propertyId: 'num', op: 'before', value: '2026-01-01' },
        { propertyId: 'date', op: 'before', value: 'не дата' },
        { propertyId: 'date', op: 'older_than', value: -5 },
        { propertyId: 'date', op: 'older_than', value: 'abc' },
      ]),
    ).toEqual(['date:before', 'date:after', 'date:older_than']);
  });

  it('in только для select/status/person и value должен быть массивом строк', () => {
    expect(isOpCompatible('in', 'selectSingle')).toBe(true);
    expect(isOpCompatible('in', 'text')).toBe(false);
    expect(
      keep([
        { propertyId: 'sel', op: 'in', value: ['a', 'b'] },
        { propertyId: 'sel', op: 'in', value: 'a' },
        { propertyId: 'text', op: 'in', value: ['a'] },
      ]),
    ).toEqual(['sel:in']);
  });

  it('ФИКС 1: пустой массив в `in` отбрасывается', () => {
    expect(
      keep([
        { propertyId: 'sel', op: 'in', value: [] },
        { propertyId: 'sel', op: 'in', value: ['x'] },
      ]),
    ).toEqual(['sel:in']);
  });

  it('ФИКС 2: gt/lt со строковым мусором (не число и не дата) отбрасывается', () => {
    expect(
      keep([
        { propertyId: 'num', op: 'gt', value: 'дорогой' },
        { propertyId: 'num', op: 'lt', value: '   ' },
        { propertyId: 'num', op: 'gt', value: '42' },
        { propertyId: 'date', op: 'lt', value: '2026-05-01' },
      ]),
    ).toEqual(['num:gt', 'date:lt']);
  });

  it('empty нормализуется без value', () => {
    const out = validateFilters([{ propertyId: 'text', op: 'empty', value: 'мусор' }], props);
    expect(out).toEqual([{ propertyId: 'text', op: 'empty' }]);
  });

  it('несуществующий propertyId отбрасывается', () => {
    expect(keep([{ propertyId: 'nope', op: 'eq', value: 'x' }])).toEqual([]);
  });
});

describe('cellMatchesCondition / rowMatchesConditions (семантика операторов)', () => {
  it('eq / neq — свободное равенство по строковому представлению', () => {
    expect(cellMatchesCondition('100', { propertyId: 'p', op: 'eq', value: 100 })).toBe(true);
    expect(cellMatchesCondition('Москва', { propertyId: 'p', op: 'eq', value: 'Москва' })).toBe(
      true,
    );
    expect(cellMatchesCondition('Питер', { propertyId: 'p', op: 'neq', value: 'Москва' })).toBe(
      true,
    );
    expect(cellMatchesCondition('Москва', { propertyId: 'p', op: 'neq', value: 'Москва' })).toBe(
      false,
    );
  });

  it('empty — пусто/[]/undefined', () => {
    expect(cellMatchesCondition(undefined, { propertyId: 'p', op: 'empty' })).toBe(true);
    expect(cellMatchesCondition('', { propertyId: 'p', op: 'empty' })).toBe(true);
    expect(cellMatchesCondition([], { propertyId: 'p', op: 'empty' })).toBe(true);
    expect(cellMatchesCondition('x', { propertyId: 'p', op: 'empty' })).toBe(false);
  });

  it('in — скаляр или массив ячейки против needles', () => {
    expect(
      cellMatchesCondition('active', { propertyId: 'p', op: 'in', value: ['active', 'lead'] }),
    ).toBe(true);
    expect(cellMatchesCondition(['a', 'b'], { propertyId: 'p', op: 'in', value: ['b'] })).toBe(
      true,
    );
    expect(cellMatchesCondition('closed', { propertyId: 'p', op: 'in', value: ['active'] })).toBe(
      false,
    );
  });

  it('contains — подстрока без учёта регистра', () => {
    expect(
      cellMatchesCondition('ООО Ромашка', { propertyId: 'p', op: 'contains', value: 'ромашка' }),
    ).toBe(true);
    expect(
      cellMatchesCondition('ООО Ромашка', { propertyId: 'p', op: 'contains', value: 'дуб' }),
    ).toBe(false);
  });

  it('gt / lt — числа и даты', () => {
    expect(cellMatchesCondition(150000, { propertyId: 'p', op: 'gt', value: 100000 })).toBe(true);
    expect(cellMatchesCondition('50', { propertyId: 'p', op: 'lt', value: 100 })).toBe(true);
    expect(
      cellMatchesCondition('2026-06-01', { propertyId: 'p', op: 'gt', value: '2026-01-01' }),
    ).toBe(true);
    expect(cellMatchesCondition('дорого', { propertyId: 'p', op: 'gt', value: 10 })).toBe(false);
  });

  it('before / after / older_than — даты', () => {
    expect(
      cellMatchesCondition('2026-01-01', { propertyId: 'p', op: 'before', value: '2026-05-01' }),
    ).toBe(true);
    expect(
      cellMatchesCondition('2026-06-01', { propertyId: 'p', op: 'after', value: '2026-05-01' }),
    ).toBe(true);
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(cellMatchesCondition(old, { propertyId: 'p', op: 'older_than', value: 30 })).toBe(true);
    expect(cellMatchesCondition(recent, { propertyId: 'p', op: 'older_than', value: 30 })).toBe(
      false,
    );
  });

  it('rowMatchesConditions — AND по всем условиям; пустой фильтр → проходит', () => {
    const cells = { city: 'Москва', amount: 150000 };
    expect(rowMatchesConditions(cells, [])).toBe(true);
    expect(
      rowMatchesConditions(cells, [
        { propertyId: 'city', op: 'eq', value: 'Москва' },
        { propertyId: 'amount', op: 'gt', value: 100000 },
      ]),
    ).toBe(true);
    expect(
      rowMatchesConditions(cells, [
        { propertyId: 'city', op: 'eq', value: 'Москва' },
        { propertyId: 'amount', op: 'gt', value: 200000 },
      ]),
    ).toBe(false);
  });
});

describe('TableSemanticFilterService.applyFilterToRows (server-side)', () => {
  const TENANT = 'org-1';
  const TABLE = 'tbl-1';

  let findMany: ReturnType<typeof vi.fn>;
  let svc: TableSemanticFilterService;

  const ROWS = [
    { id: 'r1', entityId: 'e1', cells: { city: 'Москва', amount: 150000 } },
    { id: 'r2', entityId: null, cells: { city: 'Питер', amount: 50000 } },
    { id: 'r3', entityId: 'e3', cells: { city: 'Москва', amount: 80000 } },
  ];

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue(ROWS);
    const prisma = {
      tableRow: { findMany },
    } as unknown as PrismaService;
    const llm = { call: vi.fn() } as unknown as LlmRouterService;
    const redis = {
      client: { get: vi.fn(), set: vi.fn() },
    } as unknown as RedisService;
    svc = new TableSemanticFilterService(llm, prisma, redis);
  });

  it('eq — отбирает только совпавшие строки', async () => {
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [{ propertyId: 'city', op: 'eq', value: 'Москва' }],
      limit: 20,
    });
    expect(out.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(out[0]).toEqual({
      id: 'r1',
      entityId: 'e1',
      cells: { city: 'Москва', amount: 150000 },
      sourceObjectType: null,
      sourceObjectId: null,
    });
    const where = (findMany.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(where).toMatchObject({
      tableId: TABLE,
      tenantId: TENANT,
      archivedAt: null,
      deletedAt: null,
    });
  });

  it('gt — числовое сравнение', async () => {
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [{ propertyId: 'amount', op: 'gt', value: 100000 }],
      limit: 20,
    });
    expect(out.map((r) => r.id)).toEqual(['r1']);
  });

  it('in — несколько значений', async () => {
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [{ propertyId: 'city', op: 'in', value: ['Питер', 'Казань'] }],
      limit: 20,
    });
    expect(out.map((r) => r.id)).toEqual(['r2']);
  });

  it('empty — пустой результат когда ничего не подходит', async () => {
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [{ propertyId: 'city', op: 'empty' }],
      limit: 20,
    });
    expect(out).toEqual([]);
  });

  it('limit=0 → [] без запроса к БД', async () => {
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [],
      limit: 0,
    });
    expect(out).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('fail-safe: ошибка БД → [] (не бросает)', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'));
    const out = await svc.applyFilterToRows({
      tenantId: TENANT,
      tableId: TABLE,
      conditions: [{ propertyId: 'city', op: 'eq', value: 'Москва' }],
      limit: 20,
    });
    expect(out).toEqual([]);
  });
});
