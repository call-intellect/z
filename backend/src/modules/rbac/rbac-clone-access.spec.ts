/**
 * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — unit-тесты
 * `RbacService.canAccessPersonClone` / `canAccessRoleClone` в обоих режимах
 * (`cloneV2Enabled` true и false).
 *
 * Источник правды:
 *  - cloneV2Enabled=true → ТОЛЬКО CloneAccessGrant (галочка админа).
 *  - cloneV2Enabled=false → legacy логика (owner/admin Org, self, manager
 *    для person; rbac.check obj='role' act='read' для role).
 *
 * PrismaService мокаем — нас интересует поведение веток, а не I/O.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { RbacService } from './rbac.service';


interface BuildOpts {
  isSuperAdmin?: boolean;
  membership?: {
    role: 'owner' | 'admin' | 'manager' | 'coo';
    org: { visibilityMode: 'open' | 'strict' };
  } | null;
  /**
   * ТЗ 2026-05-26 §3.5 — после фикса RbacService использует `findFirst` с
   * фильтром активности (`revokedAt IS NULL AND (expiresAt IS NULL OR >now)`).
   * Тест поддерживает оба варианта мока:
   *  - `cloneAccessGrant` — простой объект, который возвращается при ЛЮБОМ where
   *    (для существующих кейсов «грант есть/нет», где активность подразумевается);
   *  - `cloneAccessGrantImpl(where)` — кастомный мок, эмулирует SQL-фильтр для
   *    revoked/expired-кейсов.
   */
  cloneAccessGrant?: { id: string } | null;
  cloneAccessGrantImpl?: (
    where: Record<string, unknown>,
  ) => Promise<{ id: string } | null>;
  target?: {
    id: string;
    userId: string | null;
    primaryDepartmentId: string | null;
    tenantId: string;
  } | null;
  requesterPerson?: {
    id: string;
    primaryDepartmentId: string | null;
  } | null;
  isRequesterManager?: boolean;
  /**
   * audit С14 (2026-05-29): defense-in-depth tenantId-check для role-клона.
   * Если не задан — мок возвращает `{ tenantId: 't-1' }` (соответствует args.tenantId
   * в большинстве тестов). Для негативных кейсов «role чужого tenant» — передайте null.
   */
  roleTenantId?: string | null;
  /**
   * audit С14 (2026-05-29): defense-in-depth tenantId-check для person-клона.
   * Если `target` не задан — мок возвращает `{ tenantId: personTenantId ?? 't-1' }`.
   */
  personTenantId?: string | null;
}

function buildRbac(opts: BuildOpts): RbacService {
  const grantFindFirst = opts.cloneAccessGrantImpl
    ? vi.fn((args: { where: Record<string, unknown> }) =>
        opts.cloneAccessGrantImpl!(args.where),
      )
    : vi.fn(async () => opts.cloneAccessGrant ?? null);

  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        isSuperAdmin: opts.isSuperAdmin === true,
      })),
    },
    membership: {
      findUnique: vi.fn(async () => opts.membership ?? null),
      findFirst: vi.fn(async () =>
        opts.isRequesterManager ? { id: 'm-1' } : null,
      ),
    },
    org: {
      findUnique: vi.fn(async () => ({ visibilityMode: 'open' })),
    },
    cloneAccessGrant: {
      // Оставлено для обратной совместимости со старыми тестами / сторонним кодом.
      findUnique: vi.fn(async () => opts.cloneAccessGrant ?? null),
      // После ТЗ 2026-05-26 §3.5 RbacService использует findFirst c активным
      // фильтром. Для revoked/expired-кейсов передавайте `cloneAccessGrantImpl`.
      findFirst: grantFindFirst,
    },
    person: {
      // audit С14 (2026-05-29): canAccessPersonClone проверяет Person.tenantId
      // ДВАЖДЫ: сначала defense-in-depth (select: { tenantId }), потом legacy
      // (select: { id, userId, primaryDepartmentId, tenantId }). Если `target`
      // явно задан — возвращаем его. Если нет — отдаём stub с совпадающим
      // tenantId, чтобы defense-in-depth пропустил и тесты v2-веток работали
      // как раньше (когда явный target не нужен). Для негативных кейсов
      // «person чужого tenant» — передайте `personTenantId: 'other'`.
      findUnique: vi.fn(async () => {
        if (opts.target !== undefined) return opts.target;
        const tenantId = opts.personTenantId ?? 't-1';
        return {
          id: 'p-1',
          userId: null,
          primaryDepartmentId: null,
          tenantId,
        };
      }),
      findFirst: vi.fn(async () => opts.requesterPerson ?? null),
    },
    role: {
      // audit С14 (2026-05-29): canAccessRoleClone проверяет Role.tenantId
      // (defense-in-depth). По умолчанию — совпадает с args.tenantId='t-1'.
      findUnique: vi.fn(async () => {
        if (opts.roleTenantId === null) return null;
        return { tenantId: opts.roleTenantId ?? 't-1' };
      }),
    },
  } as unknown as PrismaService;

  const rbac = new RbacService(prisma);
  rbac.onModuleInit();
  return rbac;
}

/**
 * Утилита: эмулирует SQL-фильтр активности гранта на уровне in-memory.
 * Возвращает { id: 'g-1' } если grant активен по правилам §3.5, иначе null.
 */
function activeGrantImpl(grant: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): (where: Record<string, unknown>) => Promise<{ id: string } | null> {
  return async () => {
    const now = new Date();
    if (grant.revokedAt !== null) return null;
    if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return { id: 'g-1' };
  };
}

describe('RbacService.canAccessPersonClone — режим cloneV2Enabled=true (галочка)', () => {
  it('грант есть → allowed=true, relation=grant', async () => {
    const rbac = buildRbac({ cloneAccessGrant: { id: 'g-1' } });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('грант отсутствует → allowed=false, даже если super_admin', async () => {
    // В режиме v2 super_admin сам должен выдать себе галочку — bypass нет.
    const rbac = buildRbac({
      isSuperAdmin: true,
      cloneAccessGrant: null,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'sa-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.relation).toBe('none');
  });

  it('грант отсутствует → allowed=false, даже если owner Org', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
      cloneAccessGrant: null,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
  });
});

describe('RbacService.canAccessPersonClone — режим cloneV2Enabled=false (legacy)', () => {
  it('owner Org → allowed=true, relation=owner_admin', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('owner_admin');
  });

  it('сам носитель → allowed=true, relation=self', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-bearer',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('self');
  });

  it('manager того же department → allowed=true, relation=manager', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
      requesterPerson: { id: 'p-req', primaryDepartmentId: 'd-1' },
      isRequesterManager: true,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-req',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('manager');
  });

  it('manager другого department → allowed=false', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
      requesterPerson: { id: 'p-req', primaryDepartmentId: 'd-OTHER' },
      isRequesterManager: true,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-req',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(false);
  });
});

describe('RbacService.canAccessRoleClone — оба режима', () => {
  it('v2 без гранта → allowed=false', async () => {
    const rbac = buildRbac({ cloneAccessGrant: null });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
  });

  it('v2 с грантом → allowed=true, relation=grant', async () => {
    const rbac = buildRbac({ cloneAccessGrant: { id: 'g-1' } });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('legacy: owner Org → allowed=true, relation=role_read', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      roleId: 'r-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('role_read');
  });

  it('legacy: без membership → allowed=false', async () => {
    const rbac = buildRbac({ membership: null });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-stranger',
      roleId: 'r-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(false);
  });
});

/**
 * ТЗ 2026-05-26 §3.5 — фикс RBAC: revoked / expired гранты НЕ должны давать
 * доступ. До фикса `canAccess*Clone` делал `findUnique` и игнорировал
 * `revokedAt`/`expiresAt`.
 */
describe('RbacService.canAccessRoleClone — режим v2: активность гранта (revoked/expired)', () => {
  it('Кейс 1: активный грант (revokedAt=null, expiresAt=null) → allowed=true', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({ revokedAt: null, expiresAt: null }),
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('Кейс 2: revoked грант (revokedAt=Date) → allowed=false', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({
        revokedAt: new Date('2026-05-20T10:00:00Z'),
        expiresAt: null,
      }),
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: false, relation: 'none' });
  });

  it('Кейс 3: expired грант (expiresAt в прошлом) → allowed=false', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({
        revokedAt: null,
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      }),
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: false, relation: 'none' });
  });

  it('Кейс 4: ещё не истекший грант (expiresAt в будущем) → allowed=true', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // +1 час
      }),
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('Кейс 5: нет гранта вовсе → allowed=false', async () => {
    const rbac = buildRbac({ cloneAccessGrant: null });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: false, relation: 'none' });
  });

  it('Sanity: findFirst вызывается с активным фильтром (revokedAt:null + OR expiresAt)', async () => {
    // Проверяем, что в where передаются revokedAt:null и OR [{expiresAt:null},{expiresAt:{gt}}].
    const calls: Array<Record<string, unknown>> = [];
    const rbac = buildRbac({
      cloneAccessGrantImpl: async (where) => {
        calls.push(where);
        return { id: 'g-1' };
      },
    });
    await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tenantId: 't-1',
      grantedToUserId: 'u-1',
      cloneType: 'role',
      cloneRefId: 'r-1',
      revokedAt: null,
    });
    expect(Array.isArray((calls[0] as { OR: unknown[] }).OR)).toBe(true);
  });
});

describe('RbacService.canAccessPersonClone — режим v2: активность гранта (revoked/expired)', () => {
  it('активный грант → allowed=true, relation=grant', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({ revokedAt: null, expiresAt: null }),
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('revoked грант → allowed=false', async () => {
    const rbac = buildRbac({
      cloneAccessGrantImpl: activeGrantImpl({
        revokedAt: new Date('2026-05-20T10:00:00Z'),
        expiresAt: null,
      }),
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: false, relation: 'none' });
  });
});

describe('RbacService.isGrantActive / buildActiveGrantWhere (helpers §3.5)', () => {
  const now = new Date('2026-05-26T12:00:00Z');

  it('isGrantActive: revokedAt=null, expiresAt=null → true', () => {
    expect(
      RbacService.isGrantActive({ revokedAt: null, expiresAt: null }, now),
    ).toBe(true);
  });

  it('isGrantActive: revokedAt set → false', () => {
    expect(
      RbacService.isGrantActive(
        { revokedAt: new Date('2026-05-01T00:00:00Z'), expiresAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('isGrantActive: expiresAt в прошлом → false', () => {
    expect(
      RbacService.isGrantActive(
        { revokedAt: null, expiresAt: new Date('2020-01-01T00:00:00Z') },
        now,
      ),
    ).toBe(false);
  });

  it('isGrantActive: expiresAt в будущем → true', () => {
    expect(
      RbacService.isGrantActive(
        { revokedAt: null, expiresAt: new Date('2099-01-01T00:00:00Z') },
        now,
      ),
    ).toBe(true);
  });

  it('isGrantActive: expiresAt === now → false (граница включительно)', () => {
    expect(
      RbacService.isGrantActive({ revokedAt: null, expiresAt: now }, now),
    ).toBe(false);
  });

  it('buildActiveGrantWhere: revokedAt:null + OR на expiresAt', () => {
    const where = RbacService.buildActiveGrantWhere(now);
    expect(where).toEqual({
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
  });
});
