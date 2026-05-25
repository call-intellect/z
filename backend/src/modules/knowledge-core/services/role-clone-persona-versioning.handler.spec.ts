/**
 * Clones=Roles Ф2 — unit-тесты `RoleClonePersonaVersioningHandler`.
 *
 * Покрытие:
 *   1. Первое событие на роль без прежней active persona — создаётся
 *      pending_rebuild с roleVersion=1 (или next от последнего, если уже
 *      есть archived от backfill).
 *   2. Смена носителя: existing active(personA) → новый personB. Старая
 *      становится superseded, новая создаётся (roleVersion=prev+1).
 *   3. Идемпотентность: повторный event с тем же newPersonId, когда уже
 *      есть active на этого носителя — НЕ создаёт новой версии.
 *
 * Prisma + builder мокаются — handler работает только с моками.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  RoleClonePersonaVersioningHandler,
  type RoleBearerChangedEvent,
} from './role-clone-persona-versioning.handler';

import type { ExecutablePersonaBuildService } from './executable-persona-build.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

// ─────────────────────────── helpers ───────────────────────────

interface PersonaRow {
  id: string;
  roleVersion: number | null;
  version: number;
  currentBearerPersonId: string | null;
  status: 'active' | 'superseded' | 'pending_rebuild';
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
        // Сортировка по roleVersion DESC.
        pool = pool.sort((a, b) => (b.roleVersion ?? 0) - (a.roleVersion ?? 0));
        return pool[0] ?? null;
      }),
      updateMany: vi.fn(async (q: { where: unknown; data: unknown }) => {
        updateManyCalls.push(q);
        const w = q.where as { id?: string; status?: string };
        const d = q.data as { status?: 'active' | 'superseded' | 'pending_rebuild' };
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
          currentBearerPersonId:
            (data.currentBearerPersonId as string | null) ?? null,
          status: data.status as 'active' | 'pending_rebuild' | 'superseded',
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

function buildBuilderMock(): ExecutablePersonaBuildService {
  return {
    buildForRole: vi.fn(async () => null), // нет реальной пересборки — ок для unit
    buildForProfile: vi.fn(async () => null),
  } as unknown as ExecutablePersonaBuildService;
}

function buildMetricsMock(): BusinessMetricsService {
  return {
    incCloneRoleVersionCreated: vi.fn(),
    setCloneRoleVersionsTotal: vi.fn(),
  } as unknown as BusinessMetricsService;
}

const ROLE = {
  id: 'role-1',
  name: 'Маркетолог',
  tenantId: 't-1',
  deletedAt: null,
};

// ─────────────────────────── tests ───────────────────────────

describe('RoleClonePersonaVersioningHandler', () => {
  it('Сценарий A: первая смена носителя при существующей active(personA) → новая pending_rebuild v2, старая superseded', async () => {
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
    const handler = new RoleClonePersonaVersioningHandler(
      prisma,
      buildBuilderMock(),
      buildMetricsMock(),
    );

    const event: RoleBearerChangedEvent = {
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: 'person-B',
      changedAt: new Date('2026-05-25T10:00:00Z'),
    };
    const personaId = await handler.handle(event);

    expect(personaId).not.toBeNull();
    expect(createdPersonas).toHaveLength(1);
    expect(createdPersonas[0]?.roleVersion).toBe(2);
    expect(createdPersonas[0]?.currentBearerPersonId).toBe('person-B');
    expect(createdPersonas[0]?.status).toBe('pending_rebuild');
    expect(createdPersonas[0]?.succeedsPersonaId).toBe('persona-v1');

    // Старая active должна быть помечена superseded — updateMany по id=persona-v1.
    const supersedeCall = updateManyCalls.find(
      (c) =>
        (c.where as { id?: string }).id === 'persona-v1' &&
        (c.data as { status?: string }).status === 'superseded',
    );
    expect(supersedeCall).toBeDefined();
  });

  it('Сценарий B: повторный event на того же newPersonId, когда уже есть active(personB) → skip (no new persona)', async () => {
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
    const handler = new RoleClonePersonaVersioningHandler(
      prisma,
      buildBuilderMock(),
      buildMetricsMock(),
    );

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A', // не важно
      newPersonId: 'person-B', // тот же что и в active
      changedAt: new Date(),
    });

    expect(personaId).toBeNull();
    expect(createdPersonas).toHaveLength(0);
  });

  it('Сценарий C: пара (newPersonId=null = роль освободилась) при existing active(personA) → создаётся новая pending_rebuild v2 с bearer=null', async () => {
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
    const handler = new RoleClonePersonaVersioningHandler(
      prisma,
      buildBuilderMock(),
      buildMetricsMock(),
    );

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-1',
      oldPersonId: 'person-A',
      newPersonId: null,
      changedAt: new Date(),
    });

    expect(personaId).not.toBeNull();
    expect(createdPersonas).toHaveLength(1);
    expect(createdPersonas[0]?.currentBearerPersonId).toBeNull();
    expect(createdPersonas[0]?.status).toBe('pending_rebuild');
    expect(createdPersonas[0]?.roleVersion).toBe(2);
  });

  it('Сценарий D: Role не существует / удалена → skip (без exceptions, без create)', async () => {
    const { prisma, createdPersonas } = buildPrismaMock({
      role: null,
      existingPersonas: [],
    });
    const handler = new RoleClonePersonaVersioningHandler(
      prisma,
      buildBuilderMock(),
      buildMetricsMock(),
    );

    const personaId = await handler.handle({
      tenantId: 't-1',
      roleId: 'role-deleted',
      oldPersonId: null,
      newPersonId: 'person-B',
      changedAt: new Date(),
    });

    expect(personaId).toBeNull();
    expect(createdPersonas).toHaveLength(0);
  });
});
