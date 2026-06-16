import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ExecutablePersonaBuildService } from './executable-persona-build.service';
import {
  RoleClonePersonaVersioningHandler,
  type RoleBearerChangedEvent,
} from './role-clone-persona-versioning.handler';

interface PersonaRow {
  id: string;
  roleVersion: number | null;
  version: number;
  currentBearerPersonId: string | null;
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  scope: 'person' | 'role';
  scopeRefId: string | null;
  succeedsPersonaId: string | null;
  snapshotAt: Date;
  tenantId: string;
}

function buildPrismaMock(args: {
  role: { id: string; name: string; tenantId: string; deletedAt: Date | null } | null;
  existingPersonas: PersonaRow[];
}): {
  prisma: PrismaService;
  createdPersonas: PersonaRow[];
  updateManyCalls: Array<{ where: unknown; data: unknown }>;
} {
  const createdPersonas: PersonaRow[] = [];
  const updateManyCalls: Array<{ where: unknown; data: unknown }> = [];
  const personas: PersonaRow[] = [...args.existingPersonas];

  const prisma = {
    role: {
      findUnique: vi.fn(async () => args.role),
    },
    executablePersona: {
      findFirst: vi.fn(async (q: { where: Record<string, unknown> }) => {
        const where = q.where as {
          scope?: string;
          scopeRefId?: string;
          status?: string;
          currentBearerPersonId?: string | null;
          succeedsPersonaId?: string | null;
        };
        let pool = personas.filter((p) => {
          if (where.scope && p.scope !== where.scope) return false;
          if (where.scopeRefId && p.scopeRefId !== where.scopeRefId) return false;
          if (where.status && p.status !== where.status) return false;
          if (
            where.currentBearerPersonId !== undefined &&
            p.currentBearerPersonId !== where.currentBearerPersonId
          )
            return false;
          if (
            where.succeedsPersonaId !== undefined &&
            p.succeedsPersonaId !== where.succeedsPersonaId
          )
            return false;
          return true;
        });
        pool = pool.sort((a, b) => (b.roleVersion ?? 0) - (a.roleVersion ?? 0));
        return pool[0] ?? null;
      }),
      updateMany: vi.fn(async (q: { where: unknown; data: unknown }) => {
        updateManyCalls.push(q);
        const w = q.where as { id?: string; status?: string };
        const d = q.data as {
          status?: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
        };
        for (const p of personas) {
          if (w.id && p.id !== w.id) continue;
          if (w.status && p.status !== w.status) continue;
          if (d.status) p.status = d.status;
        }
        return { count: 1 };
      }),
      create: vi.fn(async (q: { data: Record<string, unknown> }) => {
        const data = q.data;
        const row: PersonaRow = {
          id: `persona-${createdPersonas.length + personas.length + 1}`,
          tenantId: String(data.tenantId),
          scope: data.scope as 'role' | 'person',
          scopeRefId: (data.scopeRefId as string | null) ?? null,
          roleVersion: (data.roleVersion as number | null) ?? null,
          version: (data.version as number) ?? 1,
          currentBearerPersonId: (data.currentBearerPersonId as string | null) ?? null,
          status: data.status as PersonaRow['status'],
          succeedsPersonaId: (data.succeedsPersonaId as string | null) ?? null,
          snapshotAt: new Date(),
        };
        createdPersonas.push(row);
        personas.push(row);
        return row;
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  } as unknown as PrismaService;

  return { prisma, createdPersonas, updateManyCalls };
}

function buildBuilderMock(builtPersona?: {
  id: string;
  status: string;
  roleVersion: number | null;
}): {
  builder: ExecutablePersonaBuildService;
  buildForRole: ReturnType<typeof vi.fn>;
} {
  const buildForRole = vi.fn(async () => builtPersona ?? null);
  const builder = {
    buildForRole,
    buildForProfile: vi.fn(async () => null),
  } as unknown as ExecutablePersonaBuildService;
  return { builder, buildForRole };
}

function buildMetricsMock(): {
  metrics: BusinessMetricsService;
  incCloneRoleVersionCreated: ReturnType<typeof vi.fn>;
} {
  const incCloneRoleVersionCreated = vi.fn();
  const metrics = {
    incCloneRoleVersionCreated,
    setCloneRoleVersionsTotal: vi.fn(),
  } as unknown as BusinessMetricsService;
  return { metrics, incCloneRoleVersionCreated };
}

const ROLE = {
  id: 'role-1',
  name: 'Маркетолог',
  tenantId: 't-1',
  deletedAt: null,
};

describe('RoleClonePersonaVersioningHandler (Раздел 7)', () => {
  it('Сценарий A: новый носитель → делегирует buildForRole(bearerPersonId=personB); handler сам персон не создаёт', async () => {
    const existingActive: PersonaRow = {
      id: 'persona-v1',
      roleVersion: 1,
      version: 1,
      currentBearerPersonId: 'person-A',
      status: 'active',
      scope: 'role',
      scopeRefId: 'role-1',
      succeedsPersonaId: null,
      snapshotAt: new Date('2026-05-01T00:00:00Z'),
      tenantId: 't-1',
    };
    const { prisma, createdPersonas } = buildPrismaMock({
      role: ROLE,
      existingPersonas: [existingActive],
    });
    const { builder, buildForRole } = buildBuilderMock({
      id: 'persona-v2',
      status: 'active',
      roleVersion: 2,
    });
    const { metrics, incCloneRoleVersionCreated } = buildMetricsMock();
    const handler = new RoleClonePersonaVersioningHandler(prisma, builder, metrics);

    const event: RoleBearerChangedEvent = {
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: 'person-B',
      changedAt: new Date('2026-05-25T10:00:00Z'),
    };
    const personaId = await handler.handle(event);

    expect(personaId).toBe('persona-v2');
    expect(buildForRole).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        roleId: 'role-1',
        bearerPersonId: 'person-B',
      }),
    );
    expect(incCloneRoleVersionCreated).toHaveBeenCalledTimes(1);
    expect(createdPersonas).toHaveLength(0);
  });

  it('Сценарий A2: новый носитель, но build вернул null (мало traits) → handler возвращает null, прошлая active не трогается', async () => {
    const existingActive: PersonaRow = {
      id: 'persona-v1',
      roleVersion: 1,
      version: 1,
      currentBearerPersonId: 'person-A',
      status: 'active',
      scope: 'role',
      scopeRefId: 'role-1',
      succeedsPersonaId: null,
      snapshotAt: new Date('2026-05-01T00:00:00Z'),
      tenantId: 't-1',
    };
    const { prisma, createdPersonas, updateManyCalls } = buildPrismaMock({
      role: ROLE,
      existingPersonas: [existingActive],
    });
    const { builder } = buildBuilderMock();
    const { metrics, incCloneRoleVersionCreated } = buildMetricsMock();
    const handler = new RoleClonePersonaVersioningHandler(prisma, builder, metrics);

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: 'person-B',
      changedAt: new Date(),
    });

    expect(personaId).toBeNull();
    expect(createdPersonas).toHaveLength(0);
    expect(incCloneRoleVersionCreated).not.toHaveBeenCalled();
    expect(updateManyCalls).toHaveLength(0);
    expect(existingActive.status).toBe('active');
  });

  it('Сценарий B: повторный event на того же newPersonId, когда уже есть active(personB) → skip (no build)', async () => {
    const existingActive: PersonaRow = {
      id: 'persona-v2',
      roleVersion: 2,
      version: 2,
      currentBearerPersonId: 'person-B',
      status: 'active',
      scope: 'role',
      scopeRefId: 'role-1',
      succeedsPersonaId: 'persona-v1',
      snapshotAt: new Date('2026-05-25T10:00:00Z'),
      tenantId: 't-1',
    };
    const { prisma, createdPersonas } = buildPrismaMock({
      role: ROLE,
      existingPersonas: [existingActive],
    });
    const { builder, buildForRole } = buildBuilderMock();
    const { metrics } = buildMetricsMock();
    const handler = new RoleClonePersonaVersioningHandler(prisma, builder, metrics);

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: 'person-B',
      changedAt: new Date(),
    });

    expect(personaId).toBeNull();
    expect(createdPersonas).toHaveLength(0);
    expect(buildForRole).not.toHaveBeenCalled();
  });

  it('Сценарий C: роль освободилась (newPersonId=null) при active(personA) → текущий клон заморожен (frozen), новый не строится', async () => {
    const existingActive: PersonaRow = {
      id: 'persona-v1',
      roleVersion: 1,
      version: 1,
      currentBearerPersonId: 'person-A',
      status: 'active',
      scope: 'role',
      scopeRefId: 'role-1',
      succeedsPersonaId: null,
      snapshotAt: new Date('2026-05-01T00:00:00Z'),
      tenantId: 't-1',
    };
    const { prisma, createdPersonas, updateManyCalls } = buildPrismaMock({
      role: ROLE,
      existingPersonas: [existingActive],
    });
    const { builder, buildForRole } = buildBuilderMock();
    const { metrics } = buildMetricsMock();
    const handler = new RoleClonePersonaVersioningHandler(prisma, builder, metrics);

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: null,
      changedAt: new Date(),
    });

    expect(personaId).toBe('persona-v1');
    expect(createdPersonas).toHaveLength(0);
    expect(buildForRole).not.toHaveBeenCalled();
    const freezeCall = updateManyCalls.find(
      (c) =>
        (c.where as { id?: string }).id === 'persona-v1' &&
        (c.data as { status?: string }).status === 'frozen',
    );
    expect(freezeCall).toBeDefined();
    expect(existingActive.status).toBe('frozen');
  });

  it('Сценарий D: Role не существует / удалена → skip (без exceptions, без build)', async () => {
    const { prisma, createdPersonas } = buildPrismaMock({
      role: null,
      existingPersonas: [],
    });
    const { builder, buildForRole } = buildBuilderMock();
    const { metrics } = buildMetricsMock();
    const handler = new RoleClonePersonaVersioningHandler(prisma, builder, metrics);

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-deleted',
      oldPersonId: null,
      newPersonId: 'person-B',
      changedAt: new Date(),
    });

    expect(personaId).toBeNull();
    expect(createdPersonas).toHaveLength(0);
    expect(buildForRole).not.toHaveBeenCalled();
  });
});
