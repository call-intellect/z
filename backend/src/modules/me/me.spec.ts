import { describe, expect, it, vi } from 'vitest';

import type { RoleMapDto } from '../role-map/dto/role-map.dto';
import type { RoleMapBuilderService } from '../role-map/services/role-map-builder.service';

import { MeService } from './me.service';

type PersonRow = {
  id: string;
  name: string;
  email: string;
  primaryDepartment: { id: string; name: string } | null;
  personRoles: Array<{
    role: {
      id: string;
      name: string;
      roleProfile: {
        id: string;
        status: 'forming' | 'ready' | 'stale' | 'error';
        buildVersion: number;
        lastBuildAt: Date | null;
      } | null;
    };
  }>;
};

function makePrisma(person: PersonRow | null) {
  return {
    person: { findFirst: vi.fn().mockResolvedValue(person) },
  } as unknown as ConstructorParameters<typeof MeService>[0];
}

function makeRoleMap(roleId: string): RoleMapDto {
  return {
    role: {
      id: roleId,
      name: 'Маркетолог',
      departmentId: null,
      departmentName: null,
      missionStatement: 'Растить узнаваемость',
    },
    responsibilities: [],
    authority: [],
    knowledge: [],
    decisions: [],
    interactions: [],
    metrics: [],
    completeness: 0.444,
    maturityScore: null,
    counts: {
      responsibilities: 2,
      authority: 1,
      knowledge: 0,
      decisions: 0,
      interactions: 0,
      metrics: 1,
    },
    summaryCache: null,
    builtAt: '2026-06-15T00:00:00.000Z',
    isForming: false,
  };
}

function personWithRole(roleId: string): PersonRow {
  return {
    id: 'p1',
    name: 'Иван',
    email: 'ivan@example.com',
    primaryDepartment: { id: 'd1', name: 'Маркетинг' },
    personRoles: [
      {
        role: {
          id: roleId,
          name: 'Маркетолог',
          roleProfile: {
            id: 'rp1',
            status: 'ready',
            buildVersion: 3,
            lastBuildAt: new Date('2026-06-15T00:00:00.000Z'),
          },
        },
      },
    ],
  };
}

describe('MeService.getProfile — roleMap', () => {
  it('заполняет roleMap для пользователя с primaryRole и собранной картой', async () => {
    const prisma = makePrisma(personWithRole('role-1'));
    const map = makeRoleMap('role-1');
    const builder = {
      getMap: vi.fn().mockResolvedValue(map),
    } as unknown as RoleMapBuilderService;

    const svc = new MeService(prisma, builder);
    const res = await svc.getProfile({ tenantId: 't1', userId: 'u1' });

    expect(builder.getMap).toHaveBeenCalledWith({
      tenantId: 't1',
      roleId: 'role-1',
    });
    expect(res.primaryRole).toEqual({ id: 'role-1', name: 'Маркетолог' });
    expect(res.roleProfile).not.toBeNull();
    expect(res.roleProfile?.roleMap).toEqual(map);
  });

  it('roleMap=null когда у пользователя нет роли (personRoles пустой)', async () => {
    const person = personWithRole('role-1');
    person.personRoles = [];
    const prisma = makePrisma(person);
    const builder = {
      getMap: vi.fn(),
    } as unknown as RoleMapBuilderService;

    const svc = new MeService(prisma, builder);
    const res = await svc.getProfile({ tenantId: 't1', userId: 'u1' });

    expect(builder.getMap).not.toHaveBeenCalled();
    expect(res.primaryRole).toBeNull();
    expect(res.roleProfile).toBeNull();
  });

  it('roleMap=null когда сервис карты падает (мягкая деградация)', async () => {
    const prisma = makePrisma(personWithRole('role-1'));
    const builder = {
      getMap: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as RoleMapBuilderService;

    const svc = new MeService(prisma, builder);
    const res = await svc.getProfile({ tenantId: 't1', userId: 'u1' });

    expect(builder.getMap).toHaveBeenCalledOnce();
    expect(res.roleProfile).not.toBeNull();
    expect(res.roleProfile?.roleMap).toBeNull();
  });

  it('roleMap=null когда сервис карты не зарезолвился (@Optional → null)', async () => {
    const prisma = makePrisma(personWithRole('role-1'));
    const svc = new MeService(prisma);
    const res = await svc.getProfile({ tenantId: 't1', userId: 'u1' });

    expect(res.roleProfile).not.toBeNull();
    expect(res.roleProfile?.roleMap).toBeNull();
  });

  it('возвращает все null-поля, если Person не найден', async () => {
    const prisma = makePrisma(null);
    const builder = {
      getMap: vi.fn(),
    } as unknown as RoleMapBuilderService;

    const svc = new MeService(prisma, builder);
    const res = await svc.getProfile({ tenantId: 't1', userId: 'u1' });

    expect(builder.getMap).not.toHaveBeenCalled();
    expect(res.person).toBeNull();
    expect(res.primaryRole).toBeNull();
    expect(res.primaryDepartment).toBeNull();
    expect(res.roleProfile).toBeNull();
  });
});
