import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SYSTEM_TABLES_CATALOG } from '../templates/system-tables.catalog';

import { TablesAutoProvisionService } from './tables-auto-provision.service';

const VALID_PROP_TYPES = new Set([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'file',
  'formula',
  'relation',
  'rollup',
  'createdAt',
  'updatedAt',
  'createdBy',
  'entityLink',
  'meetingLink',
  'documentLink',
]);

describe('TablesAutoProvisionService', () => {
  const TENANT = 'org-1';
  const OWNER = 'user-1';

  let prisma: PrismaService;
  let svc: TablesAutoProvisionService;

  let tableFindFirst: ReturnType<typeof vi.fn>;
  let tableCreate: ReturnType<typeof vi.fn>;
  let propertyCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tableFindFirst = vi.fn();
    tableCreate = vi.fn();
    propertyCreate = vi.fn();

    prisma = {
      table: {
        findFirst: tableFindFirst,
        create: tableCreate,
      },
      tableProperty: {
        create: propertyCreate,
      },
    } as unknown as PrismaService;

    svc = new TablesAutoProvisionService(prisma);
  });

  it('(a) на чистом Org создаёт 10 системных таблиц с правильными systemKey', async () => {
    tableFindFirst.mockResolvedValue(null);
    let seq = 0;
    tableCreate.mockImplementation(() => Promise.resolve({ id: `t-${++seq}` }));
    propertyCreate.mockResolvedValue({ id: 'p' });

    const out = await svc.provisionDefaults(TENANT, OWNER);

    expect(out).toEqual({ created: 10, skipped: 0 });
    expect(tableCreate).toHaveBeenCalledTimes(10);

    const createdKeys = tableCreate.mock.calls.map(
      (c) => (c[0] as { data: { systemKey: string } }).data.systemKey,
    );
    const expectedKeys = SYSTEM_TABLES_CATALOG.map((t) => t.systemKey);
    expect(new Set(createdKeys)).toEqual(new Set(expectedKeys));

    for (const call of tableCreate.mock.calls) {
      const data = (call[0] as { data: Record<string, unknown> }).data;
      expect(data.isSystem).toBe(true);
      expect(data.tenantId).toBe(TENANT);
      expect(data.createdBy).toBe(OWNER);
    }
  });

  it('(b) идемпотентность: все systemKey уже есть → create не вызывается', async () => {
    tableFindFirst.mockResolvedValue({ id: 'existing' });

    const out = await svc.provisionDefaults(TENANT, OWNER);

    expect(out).toEqual({ created: 0, skipped: 10 });
    expect(tableCreate).not.toHaveBeenCalled();
    expect(propertyCreate).not.toHaveBeenCalled();
  });

  it('(c) каталог: ровно 10 шаблонов, у каждого один isPrimary, валидные типы', () => {
    expect(SYSTEM_TABLES_CATALOG).toHaveLength(10);

    const keys = SYSTEM_TABLES_CATALOG.map((t) => t.systemKey);
    expect(new Set(keys).size).toBe(10);

    for (const tpl of SYSTEM_TABLES_CATALOG) {
      const primaries = tpl.properties.filter((p) => p.isPrimary === true);
      expect(primaries).toHaveLength(1);
      expect(tpl.properties.length).toBeGreaterThan(0);
      for (const p of tpl.properties) {
        expect(VALID_PROP_TYPES.has(p.type)).toBe(true);
      }
    }
  });
});
