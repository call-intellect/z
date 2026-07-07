import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { TableSemanticFilterService } from '../../tables/services/table-semantic-filter.service';

import { ChatV2TableContextService } from './chat-v2-table-context.service';

describe('ChatV2TableContextService (ЧАСТЬ B — таблицы как источник chat_v2)', () => {
  const TENANT = 'org-1';

  let tableRowFindMany: ReturnType<typeof vi.fn>;
  let tableFindMany: ReturnType<typeof vi.fn>;
  let tablePropertyFindMany: ReturnType<typeof vi.fn>;
  let getDynamic: ReturnType<typeof vi.fn>;
  let parseSemanticFilter: ReturnType<typeof vi.fn>;
  let applyFilterToRows: ReturnType<typeof vi.fn>;

  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let semanticFilter: TableSemanticFilterService;

  function makeService(withSemanticFilter = true): ChatV2TableContextService {
    return new ChatV2TableContextService(
      prisma,
      cfg,
      withSemanticFilter ? semanticFilter : undefined,
    );
  }

  beforeEach(() => {
    tableRowFindMany = vi.fn().mockResolvedValue([]);
    tableFindMany = vi.fn().mockResolvedValue([]);
    tablePropertyFindMany = vi.fn().mockResolvedValue([]);
    parseSemanticFilter = vi.fn().mockResolvedValue({ filters: [], cached: false });
    applyFilterToRows = vi.fn().mockResolvedValue([]);

    getDynamic = vi.fn(async (_key: string, _env: unknown, def: unknown) => def);

    prisma = {
      tableRow: { findMany: tableRowFindMany },
      table: { findMany: tableFindMany },
      tableProperty: { findMany: tablePropertyFindMany },
    } as unknown as PrismaService;
    cfg = { getDynamic } as unknown as TypedConfigService;
    semanticFilter = {
      parseSemanticFilter,
      applyFilterToRows,
    } as unknown as TableSemanticFilterService;
  });

  it('entity-bridge: строки по entityId → человекочитаемые cells', async () => {
    tableRowFindMany.mockResolvedValueOnce([
      {
        id: 'r1',
        tableId: 't1',
        cells: { p1: 'Заречный', p2: 150000 },
        entityId: 'e-zarechny',
        sourceObjectType: 'idea_block',
        sourceObjectId: 'blk-1',
        table: { name: 'Клиенты' },
      },
    ]);
    tablePropertyFindMany.mockResolvedValueOnce([
      { id: 'p1', name: 'Название', tableId: 't1' },
      { id: 'p2', name: 'Сумма', tableId: 't1' },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['что по Заречному'],
      entityIds: ['e-zarechny'],
      entityHints: [],
      aggregation: false,
      structuralIntent: false,
    });

    expect(out).toEqual([
      {
        tableName: 'Клиенты',
        cells: 'Название=Заречный; Сумма=150000',
        sourceObjectType: 'idea_block',
        sourceObjectId: 'blk-1',
      },
    ]);
  });

  it('keyword-ветка: при structuralIntent матч таблицы → parseSemanticFilter → applyFilterToRows', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Клиенты и сделки',
        description: 'клиенты компании город сумма сделки',
        properties: [
          { id: 'p1', name: 'Город' },
          { id: 'p2', name: 'Сумма' },
        ],
      },
    ]);
    parseSemanticFilter.mockResolvedValueOnce({
      filters: [{ propertyId: 'p1', op: 'eq', value: 'Москва' }],
      cached: false,
    });
    applyFilterToRows.mockResolvedValueOnce([
      {
        id: 'r1',
        entityId: null,
        cells: { p1: 'Москва', p2: 100000 },
        sourceObjectType: null,
        sourceObjectId: null,
      },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['клиенты город сумма'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });

    expect(parseSemanticFilter).toHaveBeenCalledTimes(1);
    expect(applyFilterToRows).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      {
        tableName: 'Клиенты и сделки',
        cells: 'Город=Москва; Сумма=100000',
        sourceObjectType: null,
        sourceObjectId: null,
      },
    ]);
  });

  it('gating: без structuralIntent и без entityIds keyword-ветка НЕ запускается', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Клиенты',
        description: 'клиенты город',
        properties: [{ id: 'p1', name: 'Город' }],
      },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['клиенты город'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: false,
    });

    expect(tableFindMany).not.toHaveBeenCalled();
    expect(parseSemanticFilter).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('generic-имя колонки НЕ выбирает таблицу (перехват "Что" устранён)', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't-prom',
        name: 'Обещания и обязательства',
        description: 'обещания обязательства договорённости дедлайны',
        properties: [
          { id: 'c1', name: 'Что' },
          { id: 'c2', name: 'Срок' },
        ],
      },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['что горит'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });

    expect(parseSemanticFilter).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('морфология: «риски горят» матчит «Реестр рисков» по описанию', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't-risk',
        name: 'Реестр рисков',
        description: 'риски угрозы блокеры что мешает узкие места проблемы что горит',
        properties: [{ id: 'p1', name: 'Описание' }],
      },
    ]);
    parseSemanticFilter.mockResolvedValueOnce({ filters: [], cached: false });
    applyFilterToRows.mockResolvedValueOnce([
      {
        id: 'r1',
        entityId: null,
        cells: { p1: 'База данных упала под нагрузкой' },
        sourceObjectType: 'idea_block',
        sourceObjectId: 'blk-9',
      },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['какие риски горят'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });

    expect(parseSemanticFilter).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]?.tableName).toBe('Реестр рисков');
    expect(out[0]?.sourceObjectId).toBe('blk-9');
  });

  it('cap: table_context_max_rows ограничивает число строк', async () => {
    getDynamic.mockImplementation(async (key: string, _env: unknown, def: unknown) =>
      key === 'chat_v2.table_context_max_rows' ? 2 : def,
    );
    tableRowFindMany.mockResolvedValueOnce([
      { id: 'r1', tableId: 't1', cells: { p1: 'A' }, entityId: 'e1', table: { name: 'Т' } },
      { id: 'r2', tableId: 't2', cells: { p1: 'B' }, entityId: 'e1', table: { name: 'Т2' } },
      { id: 'r3', tableId: 't3', cells: { p1: 'C' }, entityId: 'e1', table: { name: 'Т3' } },
    ]);
    tablePropertyFindMany.mockResolvedValue([
      { id: 'p1', name: 'Имя', tableId: 't1' },
      { id: 'p1', name: 'Имя', tableId: 't2' },
      { id: 'p1', name: 'Имя', tableId: 't3' },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['все'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: false,
      structuralIntent: false,
    });

    expect(out).toHaveLength(2);
  });

  it('cap-per-entity-table: не более N строк одной (entity,table)', async () => {
    getDynamic.mockImplementation(async (key: string, _env: unknown, def: unknown) => {
      if (key === 'chat_v2.table_context_max_rows') return 10;
      if (key === 'chat_v2.table_context_max_rows_per_entity_table') return 2;
      return def;
    });
    tableRowFindMany.mockResolvedValueOnce([
      { id: 'r1', tableId: 't1', cells: { p1: 'A' }, entityId: 'e1', table: { name: 'Риски' } },
      { id: 'r2', tableId: 't1', cells: { p1: 'B' }, entityId: 'e1', table: { name: 'Риски' } },
      { id: 'r3', tableId: 't1', cells: { p1: 'C' }, entityId: 'e1', table: { name: 'Риски' } },
      { id: 'r4', tableId: 't1', cells: { p1: 'D' }, entityId: 'e1', table: { name: 'Риски' } },
    ]);
    tablePropertyFindMany.mockResolvedValue([{ id: 'p1', name: 'Описание', tableId: 't1' }]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['риски'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: false,
      structuralIntent: false,
    });

    expect(out).toHaveLength(2);
  });

  it('@Optional отсутствует: keyword-ветка пуста (только entity-bridge)', async () => {
    const svc = makeService(false);
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['сколько клиентов из Москвы'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });
    expect(out).toEqual([]);
    expect(tableFindMany).not.toHaveBeenCalled();
  });

  it('parseSemanticFilter упал → таблица пропущена, ветка не падает ([])', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Клиенты и сделки',
        description: 'клиенты город сделки компании',
        properties: [{ id: 'p1', name: 'Город' }],
      },
    ]);
    parseSemanticFilter.mockRejectedValueOnce(new Error('LLM down'));

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['клиенты город сделки'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
      structuralIntent: true,
    });
    expect(out).toEqual([]);
  });

  it('fail-safe: ошибка БД → [] (не бросает)', async () => {
    tableRowFindMany.mockRejectedValueOnce(new Error('db down'));
    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['что по Заречному'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: false,
      structuralIntent: false,
    });
    expect(out).toEqual([]);
  });

  it('aggregation=true поднимает cap строк (×2)', async () => {
    getDynamic.mockImplementation(async (key: string, _env: unknown, def: unknown) =>
      key === 'chat_v2.table_context_max_rows' ? 1 : def,
    );
    tableRowFindMany.mockResolvedValueOnce([
      { id: 'r1', tableId: 't1', cells: { p1: 'A' }, entityId: 'e1', table: { name: 'Т' } },
      { id: 'r2', tableId: 't2', cells: { p1: 'B' }, entityId: 'e1', table: { name: 'Т2' } },
    ]);
    tablePropertyFindMany.mockResolvedValue([
      { id: 'p1', name: 'Имя', tableId: 't1' },
      { id: 'p1', name: 'Имя', tableId: 't2' },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['сколько'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: true,
      structuralIntent: false,
    });
    expect(out).toHaveLength(2);
  });
});
