import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config';
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

/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — рабочий профиль.
 *
 *   - getWorkProfile: Person с timezone/work* → возвращает их + isCustom=true;
 *     Person без → дефолты + isCustom=false (cfg.getDynamic мокнут на fallback);
 *   - updateWorkProfile: невалидная timezone / workEndHour<=workStartHour →
 *     BadRequest; валидный patch → person.update вызван с нужными полями.
 */

type WorkPersonRow = {
  id?: string;
  timezone: string | null;
  workStartHour: number | null;
  workEndHour: number | null;
  workingDays: number[];
};

/** cfg-мок: getDynamic возвращает переданный code-fallback (3-й аргумент). */
function makeCfg() {
  return {
    getDynamic: vi.fn(
      async (_key: string, _env: string | undefined, fallback: unknown) =>
        fallback,
    ),
  } as unknown as TypedConfigService;
}

describe('MeService.getWorkProfile — эффективный профиль', () => {
  it('Person с личными полями → возвращает их, isCustom=true', async () => {
    const person: WorkPersonRow = {
      timezone: 'Asia/Novosibirsk',
      workStartHour: 8,
      workEndHour: 17,
      workingDays: [1, 2, 3, 4],
    };
    const prisma = {
      person: { findFirst: vi.fn().mockResolvedValue(person) },
      org: { findUnique: vi.fn() },
    } as unknown as ConstructorParameters<typeof MeService>[0];

    const svc = new MeService(prisma, null, makeCfg());
    const res = await svc.getWorkProfile({ tenantId: 't1', userId: 'u1' });

    expect(res.timezone).toBe('Asia/Novosibirsk');
    expect(res.workStartHour).toBe(8);
    expect(res.workEndHour).toBe(17);
    expect(res.workingDays).toEqual([1, 2, 3, 4]);
    expect(res.timezoneIsCustom).toBe(true);
    expect(res.hoursAreCustom).toBe(true);
    // timezone задан у Person → Org не запрашивается.
    expect(
      (prisma as unknown as { org: { findUnique: ReturnType<typeof vi.fn> } })
        .org.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('Person без личных полей → дефолты, isCustom=false (Org timezone)', async () => {
    const person: WorkPersonRow = {
      timezone: null,
      workStartHour: null,
      workEndHour: null,
      workingDays: [],
    };
    const prisma = {
      person: { findFirst: vi.fn().mockResolvedValue(person) },
      org: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'Asia/Yekaterinburg' }),
      },
    } as unknown as ConstructorParameters<typeof MeService>[0];

    const svc = new MeService(prisma, null, makeCfg());
    const res = await svc.getWorkProfile({ tenantId: 't1', userId: 'u1' });

    // Org timezone выигрывает у default_timezone, но это не «custom».
    expect(res.timezone).toBe('Asia/Yekaterinburg');
    expect(res.workStartHour).toBe(9);
    expect(res.workEndHour).toBe(18);
    expect(res.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(res.timezoneIsCustom).toBe(false);
    expect(res.hoursAreCustom).toBe(false);
  });

  it('нет cfg → code-fallback дефолты (Europe/Moscow, 9..18, Пн-Пт)', async () => {
    const person: WorkPersonRow = {
      timezone: null,
      workStartHour: null,
      workEndHour: null,
      workingDays: [],
    };
    const prisma = {
      person: { findFirst: vi.fn().mockResolvedValue(person) },
      org: { findUnique: vi.fn().mockResolvedValue({ timezone: null }) },
    } as unknown as ConstructorParameters<typeof MeService>[0];

    // cfg не передан (null) — workProfileDefaults сразу падает на code-fallback.
    const svc = new MeService(prisma);
    const res = await svc.getWorkProfile({ tenantId: 't1', userId: 'u1' });

    expect(res.timezone).toBe('Europe/Moscow');
    expect(res.workStartHour).toBe(9);
    expect(res.workEndHour).toBe(18);
    expect(res.workingDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('MeService.updateWorkProfile — валидация и запись', () => {
  function makeWritePrisma(opts: {
    person: { id: string; workStartHour: number | null; workEndHour: number | null } | null;
    /** Person-строка, которую вернёт getWorkProfile после update. */
    after?: WorkPersonRow;
  }) {
    const update = vi.fn().mockResolvedValue({});
    const findFirst = vi
      .fn()
      // 1-й вызов — внутри updateWorkProfile (select id/часы)
      .mockResolvedValueOnce(opts.person)
      // 2-й вызов — внутри getWorkProfile (после update)
      .mockResolvedValueOnce(
        opts.after ?? {
          timezone: null,
          workStartHour: null,
          workEndHour: null,
          workingDays: [],
        },
      );
    const prisma = {
      person: { findFirst, update },
      org: { findUnique: vi.fn().mockResolvedValue({ timezone: null }) },
    } as unknown as ConstructorParameters<typeof MeService>[0];
    return { prisma, update };
  }

  it('Person не найден → BadRequest person_not_found', async () => {
    const { prisma } = makeWritePrisma({ person: null });
    const svc = new MeService(prisma, null, makeCfg());
    await expect(
      svc.updateWorkProfile({
        tenantId: 't1',
        userId: 'u1',
        patch: { timezone: 'Europe/Moscow' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('невалидная timezone → BadRequest', async () => {
    const { prisma } = makeWritePrisma({
      person: { id: 'p1', workStartHour: null, workEndHour: null },
    });
    const svc = new MeService(prisma, null, makeCfg());
    await expect(
      svc.updateWorkProfile({
        tenantId: 't1',
        userId: 'u1',
        patch: { timezone: 'Not/AZone' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('workEndHour <= workStartHour → BadRequest', async () => {
    const { prisma } = makeWritePrisma({
      person: { id: 'p1', workStartHour: null, workEndHour: null },
    });
    const svc = new MeService(prisma, null, makeCfg());
    await expect(
      svc.updateWorkProfile({
        tenantId: 't1',
        userId: 'u1',
        patch: { workStartHour: 18, workEndHour: 9 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('валидный patch → person.update с нужными полями + нормализация workingDays', async () => {
    const { prisma, update } = makeWritePrisma({
      person: { id: 'p1', workStartHour: null, workEndHour: null },
      after: {
        timezone: 'Asia/Novosibirsk',
        workStartHour: 9,
        workEndHour: 18,
        workingDays: [1, 2, 3, 4, 5],
      },
    });
    const svc = new MeService(prisma, null, makeCfg());
    const res = await svc.updateWorkProfile({
      tenantId: 't1',
      userId: 'u1',
      patch: {
        timezone: 'Asia/Novosibirsk',
        workStartHour: 9,
        workEndHour: 18,
        // намеренно дубль + не по порядку → ожидаем уникальные отсортированные.
        workingDays: [5, 1, 1, 2, 3, 4],
      },
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({
          timezone: 'Asia/Novosibirsk',
          workStartHour: 9,
          workEndHour: 18,
          workingDays: [1, 2, 3, 4, 5],
        }),
      }),
    );
    expect(res.timezone).toBe('Asia/Novosibirsk');
    expect(res.timezoneIsCustom).toBe(true);
  });
});
