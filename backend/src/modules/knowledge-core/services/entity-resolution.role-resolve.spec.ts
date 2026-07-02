import { describe, expect, it, vi } from 'vitest';

import {
  normalizeEntityName,
  resolveRoleIdByName,
  type RoleLookupPrisma,
} from './entity-resolution.service';

function makeRolePrisma(roles: Array<{ id: string; name: string }>): RoleLookupPrisma & {
  role: { findMany: ReturnType<typeof vi.fn> };
} {
  return {
    role: { findMany: vi.fn().mockResolvedValue(roles) },
  };
}

describe('normalizeEntityName', () => {
  it('тримит, схлопывает пробелы, снимает кавычки', () => {
    expect(normalizeEntityName('  «Менеджер   продаж»  ')).toBe('Менеджер продаж');
    expect(normalizeEntityName('')).toBe('');
  });
});

describe('resolveRoleIdByName (чистое ядро)', () => {
  it('пустой hint → null без обращения к БД', async () => {
    const prisma = makeRolePrisma([{ id: 'r1', name: 'Менеджер' }]);
    expect(await resolveRoleIdByName(prisma, 'org-1', '   ')).toBeNull();
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('нет ролей в тенанте → null', async () => {
    const prisma = makeRolePrisma([]);
    expect(await resolveRoleIdByName(prisma, 'org-1', 'Менеджер')).toBeNull();
  });

  it('точное совпадение (case-insensitive)', async () => {
    const prisma = makeRolePrisma([
      { id: 'r1', name: 'Менеджер' },
      { id: 'r2', name: 'Юрист' },
    ]);
    expect(await resolveRoleIdByName(prisma, 'org-1', 'менеджер')).toBe('r1');
  });

  it('fuzzy ровно один кандидат → его id', async () => {
    const prisma = makeRolePrisma([
      { id: 'r1', name: 'Менеджер по продажам' },
      { id: 'r2', name: 'Юрист' },
    ]);
    expect(await resolveRoleIdByName(prisma, 'org-1', 'менеджер')).toBe('r1');
  });

  it('fuzzy неоднозначно (>1) → null', async () => {
    const prisma = makeRolePrisma([
      { id: 'r1', name: 'Менеджер по продажам' },
      { id: 'r2', name: 'Менеджер по закупкам' },
    ]);
    expect(await resolveRoleIdByName(prisma, 'org-1', 'менеджер')).toBeNull();
  });

  it('фильтрует по tenantId (where прокидывается в findMany)', async () => {
    const prisma = makeRolePrisma([{ id: 'r1', name: 'Менеджер' }]);
    await resolveRoleIdByName(prisma, 'org-42', 'Менеджер');
    expect(prisma.role.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'org-42', deletedAt: null },
      select: { id: true, name: true },
    });
  });
});
