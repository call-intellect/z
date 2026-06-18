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

    getDynamic = vi.fn(async (_key: string, _env: unknown, def: number) => def);

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
    });

    expect(out).toEqual([{ tableName: 'Клиенты', cells: 'Название=Заречный; Сумма=150000' }]);
  });

  it('keyword-ветка: матч таблицы → parseSemanticFilter → applyFilterToRows', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Клиенты',
        description: 'клиенты компании город сумма',
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
      { id: 'r1', entityId: null, cells: { p1: 'Москва', p2: 100000 } },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['клиенты город Москва сумма'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
    });

    expect(parseSemanticFilter).toHaveBeenCalledTimes(1);
    expect(applyFilterToRows).toHaveBeenCalledTimes(1);
    expect(out).toEqual([{ tableName: 'Клиенты', cells: 'Город=Москва; Сумма=100000' }]);
  });

  it('keyword-ветка: таблица без пересечения токенов НЕ выбирается', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Оборудование',
        description: 'станки гарантия инвентарь',
        properties: [{ id: 'p1', name: 'Модель' }],
      },
    ]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['поставщики с долгом'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
    });

    expect(parseSemanticFilter).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('cap: table_context_max_rows ограничивает число строк', async () => {
    getDynamic.mockImplementation(async (key: string, _env: unknown, def: number) =>
      key === 'chat_v2.table_context_max_rows' ? 2 : def,
    );
    tableRowFindMany.mockResolvedValueOnce([
      { id: 'r1', tableId: 't1', cells: { p1: 'A' }, table: { name: 'Т' } },
      { id: 'r2', tableId: 't1', cells: { p1: 'B' }, table: { name: 'Т' } },
      { id: 'r3', tableId: 't1', cells: { p1: 'C' }, table: { name: 'Т' } },
    ]);
    tablePropertyFindMany.mockResolvedValueOnce([{ id: 'p1', name: 'Имя', tableId: 't1' }]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['все'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: false,
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
    });
    expect(out).toEqual([]);
    expect(tableFindMany).not.toHaveBeenCalled();
  });

  it('parseSemanticFilter упал → таблица пропущена, ветка не падает ([])', async () => {
    tableFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Клиенты',
        description: 'город',
        properties: [{ id: 'p1', name: 'Город' }],
      },
    ]);
    parseSemanticFilter.mockRejectedValueOnce(new Error('LLM down'));

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['клиенты город'],
      entityIds: [],
      entityHints: [],
      aggregation: false,
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
    });
    expect(out).toEqual([]);
  });

  it('aggregation=true поднимает cap строк (×2)', async () => {
    getDynamic.mockImplementation(async (key: string, _env: unknown, def: number) =>
      key === 'chat_v2.table_context_max_rows' ? 1 : def,
    );
    tableRowFindMany.mockResolvedValueOnce([
      { id: 'r1', tableId: 't1', cells: { p1: 'A' }, table: { name: 'Т' } },
      { id: 'r2', tableId: 't1', cells: { p1: 'B' }, table: { name: 'Т' } },
    ]);
    tablePropertyFindMany.mockResolvedValue([{ id: 'p1', name: 'Имя', tableId: 't1' }]);

    const svc = makeService();
    const out = await svc.fetchTableContext({
      tenantId: TENANT,
      queries: ['сколько'],
      entityIds: ['e1'],
      entityHints: [],
      aggregation: true,
    });
    expect(out).toHaveLength(2);
  });
});
