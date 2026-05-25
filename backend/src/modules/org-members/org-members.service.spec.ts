/**
 * Юнит-тесты OrgMembersService (Calendar MVP, Фаза P4).
 *
 * Покрытие:
 *   - User и Person возвращаются в одном списке (правильные type-литералы);
 *   - dedup: Person с userId, совпадающим с User в результатах, исключается;
 *   - сортировка: точное начало имени → User раньше Person → по алфавиту;
 *   - пустой `q` (после trim) → пустой ответ без обращения к БД;
 *   - limit учитывается на финальной выборке.
 */
import { describe, expect, it, vi } from 'vitest';

import { OrgMembersService } from './services/org-members.service';

interface PrismaUserRow {
  id: string;
  name: string;
  email: string;
}
interface PrismaPersonRow {
  id: string;
  name: string;
  email: string;
  userId: string | null;
  relationship: string;
  primaryDepartment: { name: string } | null;
}

function buildPrismaStub(users: PrismaUserRow[], persons: PrismaPersonRow[]) {
  const stub = {
    user: { findMany: vi.fn(async () => users) },
    person: { findMany: vi.fn(async () => persons) },
  };
  return stub;
}

describe('OrgMembersService.search', () => {
  it('возвращает User и Person в одном списке с правильными type', async () => {
    const prisma = buildPrismaStub(
      [{ id: 'u-1', name: 'Иван Петров', email: 'ip@x.test' }],
      [
        {
          id: 'p-1',
          name: 'Иван Сидоров',
          email: 'is@x.test',
          userId: null,
          relationship: 'external',
          primaryDepartment: null,
        },
      ],
    );
    const svc = new OrgMembersService(prisma as never);
    const res = await svc.search({ tenantId: 'org-1', q: 'Иван', limit: 10 });
    expect(res.items).toHaveLength(2);
    const types = res.items.map((i) => i.type).sort();
    expect(types).toEqual(['person', 'user']);
    const user = res.items.find((i) => i.type === 'user');
    const person = res.items.find((i) => i.type === 'person');
    expect(user).toMatchObject({ type: 'user', userId: 'u-1', name: 'Иван Петров' });
    expect(person).toMatchObject({
      type: 'person',
      personId: 'p-1',
      relationship: 'external',
    });
  });

  it('dedup: Person с userId == User.id из результатов отбрасывается', async () => {
    const prisma = buildPrismaStub(
      [{ id: 'u-1', name: 'Иван Петров', email: 'ip@x.test' }],
      [
        {
          id: 'p-link',
          name: 'Иван Петров',
          email: 'ip@x.test',
          userId: 'u-1', // тот же человек
          relationship: 'employee',
          primaryDepartment: null,
        },
        {
          id: 'p-other',
          name: 'Иван Сидоров',
          email: 'is@x.test',
          userId: null,
          relationship: 'external',
          primaryDepartment: null,
        },
      ],
    );
    const svc = new OrgMembersService(prisma as never);
    const res = await svc.search({ tenantId: 'org-1', q: 'Иван', limit: 10 });
    expect(res.items.map((i) => ({ type: i.type, name: i.name }))).toEqual([
      { type: 'user', name: 'Иван Петров' },
      { type: 'person', name: 'Иван Сидоров' },
    ]);
  });

  it('сортировка: префикс-совпадение → User → алфавит', async () => {
    const prisma = buildPrismaStub(
      [
        { id: 'u-zz', name: 'Зинаида Алова', email: 'za@x.test' }, // не префикс
        { id: 'u-ap', name: 'Алексей Петров', email: 'ap@x.test' }, // префикс «Ал»
      ],
      [
        {
          id: 'p-ai',
          name: 'Алина Иванова',
          email: 'ai@x.test',
          userId: null,
          relationship: 'external',
          primaryDepartment: null,
        },
        {
          id: 'p-xx',
          name: 'Михаил Алексеев',
          email: 'ma@x.test',
          userId: null,
          relationship: 'external',
          primaryDepartment: null,
        },
      ],
    );
    const svc = new OrgMembersService(prisma as never);
    const res = await svc.search({ tenantId: 'org-1', q: 'Ал', limit: 10 });
    expect(res.items.map((i) => i.name)).toEqual([
      'Алексей Петров', // User + префикс
      'Алина Иванова', // Person + префикс
      'Зинаида Алова', // User без префикса (но User раньше Person)
      'Михаил Алексеев', // Person без префикса
    ]);
  });

  it('пустой q после trim → пустой ответ, без обращения к БД', async () => {
    const prisma = buildPrismaStub([], []);
    const svc = new OrgMembersService(prisma as never);
    const res = await svc.search({ tenantId: 'org-1', q: '   ', limit: 10 });
    expect(res.items).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.person.findMany).not.toHaveBeenCalled();
  });

  it('limit учитывается на финальной выборке', async () => {
    const users: PrismaUserRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `u-${i}`,
      name: `Алексей ${i}`,
      email: `u${i}@x.test`,
    }));
    const persons: PrismaPersonRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p-${i}`,
      name: `Алина ${i}`,
      email: `p${i}@x.test`,
      userId: null,
      relationship: 'external',
      primaryDepartment: null,
    }));
    const prisma = buildPrismaStub(users, persons);
    const svc = new OrgMembersService(prisma as never);
    const res = await svc.search({ tenantId: 'org-1', q: 'Ал', limit: 3 });
    expect(res.items).toHaveLength(3);
  });
});
