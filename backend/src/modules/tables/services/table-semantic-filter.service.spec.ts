import { NotFoundException } from '@nestjs/common';
import type { TablePropType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  isOpCompatible,
  validateFilters,
  type TableFilterCondition,
} from '../dto/table-filter.dto';

import { TableSemanticFilterService } from './table-semantic-filter.service';

/**
 * Unit-тесты `TableSemanticFilterService` (Smart-tables NL Saved Views, Фаза 5).
 *
 * Случаи (из ТЗ §7):
 *  (a) cache miss → LLM возвращает валидный {filters} → валидируется, кэшируется.
 *  (b) cache hit  → redis.get вернул JSON → LLM НЕ вызывается, cached:true.
 *  (c) валидатор  → несуществующий propertyId / несовместимый op / кривой value
 *                   отбрасываются.
 *  (d) LLM вернул мусор/не-JSON → {filters:[]} без краха.
 *  + юнит на validateFilters (таблица совместимости op×type).
 */
describe('TableSemanticFilterService', () => {
  const TENANT = 'org-1';
  const TABLE = 'tbl-1';

  // Колонки тестовой таблицы.
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
    // Кэш записан с TTL 7 дней (604800).
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
    expect(out.filters).toEqual([
      { propertyId: 'p-status', op: 'in', value: ['active'] },
    ]);
  });

  it('(b2) ФИКС 6: кэш ревалидируется в пустой (протух) → НЕ cached, идём в LLM', async () => {
    // В кэше лежит условие по колонке, которой уже нет в таблице → после
    // ревалидации фильтр пуст. Это НЕ должно вернуться как cached:true —
    // должен сработать LLM-путь.
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
    expect(out.filters).toEqual([
      { propertyId: 'p-name', op: 'contains', value: 'ООО' },
    ]);
  });

  it('(c) валидатор: несуществующий propertyId / несовместимый op / кривой value отброшены', async () => {
    call.mockResolvedValueOnce(
      reply({
        filters: [
          // несуществующая колонка → отброшено
          { propertyId: 'p-nope', op: 'eq', value: 'x' },
          // contains на currency (number-type) → несовместим → отброшено
          { propertyId: 'p-amount', op: 'contains', value: 'x' },
          // older_than с нечисловым value → кривая форма → отброшено
          { propertyId: 'p-last', op: 'older_than', value: 'вчера' },
          // валидное условие — остаётся
          { propertyId: 'p-name', op: 'contains', value: 'ООО' },
        ],
      }),
    );

    const out = await svc.parseSemanticFilter({
      tenantId: TENANT,
      tableId: TABLE,
      nlQuery: 'разный мусор и одно валидное',
    });

    expect(out.filters).toEqual([
      { propertyId: 'p-name', op: 'contains', value: 'ООО' },
    ]);
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
    // Пустой результат при ошибке парсинга НЕ кэшируем.
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

// ─────────────────── юнит на validateFilters (op × type) ──────────────────

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
        // некорректные:
        { propertyId: 'num', op: 'before', value: '2026-01-01' }, // op∤type
        { propertyId: 'date', op: 'before', value: 'не дата' }, // кривой value
        { propertyId: 'date', op: 'older_than', value: -5 }, // не положительное
        { propertyId: 'date', op: 'older_than', value: 'abc' }, // не число
      ]),
    ).toEqual(['date:before', 'date:after', 'date:older_than']);
  });

  it('in только для select/status/person и value должен быть массивом строк', () => {
    expect(isOpCompatible('in', 'selectSingle')).toBe(true);
    expect(isOpCompatible('in', 'text')).toBe(false);
    expect(
      keep([
        { propertyId: 'sel', op: 'in', value: ['a', 'b'] },
        { propertyId: 'sel', op: 'in', value: 'a' }, // не массив
        { propertyId: 'text', op: 'in', value: ['a'] }, // op∤type
      ]),
    ).toEqual(['sel:in']);
  });

  it('ФИКС 1: пустой массив в `in` отбрасывается', () => {
    expect(
      keep([
        { propertyId: 'sel', op: 'in', value: [] }, // пустой → отброшено
        { propertyId: 'sel', op: 'in', value: ['x'] }, // непустой → остаётся
      ]),
    ).toEqual(['sel:in']);
  });

  it('ФИКС 2: gt/lt со строковым мусором (не число и не дата) отбрасывается', () => {
    expect(
      keep([
        { propertyId: 'num', op: 'gt', value: 'дорогой' }, // мусор → отброшено
        { propertyId: 'num', op: 'lt', value: '   ' }, // пусто → отброшено
        { propertyId: 'num', op: 'gt', value: '42' }, // парсится в число → остаётся
        { propertyId: 'date', op: 'lt', value: '2026-05-01' }, // парсится в дату → остаётся
      ]),
    ).toEqual(['num:gt', 'date:lt']);
  });

  it('empty нормализуется без value', () => {
    const out = validateFilters(
      [{ propertyId: 'text', op: 'empty', value: 'мусор' }],
      props,
    );
    expect(out).toEqual([{ propertyId: 'text', op: 'empty' }]);
  });

  it('несуществующий propertyId отбрасывается', () => {
    expect(keep([{ propertyId: 'nope', op: 'eq', value: 'x' }])).toEqual([]);
  });
});
