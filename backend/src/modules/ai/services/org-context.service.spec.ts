import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { OrgContextService } from './org-context.service';

type PersonRow = {
  name: string;
  personRoles: Array<{ role: { name: string } | null }>;
  appointments: Array<{ role: { name: string } | null }>;
};

function makeService(args?: {
  useAppointment?: boolean;
  projects?: Array<{ identifier: string; name: string }>;
  goals?: Array<{ name: string }>;
  people?: PersonRow[];
}): {
  service: OrgContextService;
  projectFindMany: ReturnType<typeof vi.fn>;
  goalFindMany: ReturnType<typeof vi.fn>;
  personFindMany: ReturnType<typeof vi.fn>;
} {
  const projectFindMany = vi
    .fn()
    .mockResolvedValue(args?.projects ?? [{ identifier: 'DEV', name: 'Команда разработки' }]);
  const goalFindMany = vi.fn().mockResolvedValue(args?.goals ?? [{ name: 'Запуск v2' }]);
  const personFindMany = vi
    .fn()
    .mockResolvedValue(
      args?.people ?? [{ name: 'Иванов Сергей', personRoles: [], appointments: [] }],
    );
  const prisma = {
    project: { findMany: projectFindMany },
    goal: { findMany: goalFindMany },
    person: { findMany: personFindMany },
  } as unknown as PrismaService;
  const cfg = {
    persons: { useAppointment: args?.useAppointment ?? false },
  } as unknown as TypedConfigService;
  return {
    service: new OrgContextService(prisma, cfg),
    projectFindMany,
    goalFindMany,
    personFindMany,
  };
}

describe('OrgContextService.load', () => {
  it('возвращает {projects, goals, people, meetingDateIso}', async () => {
    const { service } = makeService();
    const ctx = await service.load('org-1', new Date('2026-05-24T10:00:00.000Z'));
    expect(ctx.projects).toEqual([{ identifier: 'DEV', name: 'Команда разработки' }]);
    expect(ctx.goals).toEqual([{ name: 'Запуск v2' }]);
    expect(ctx.people).toEqual([{ name: 'Иванов Сергей', role: null }]);
    expect(ctx.meetingDateIso).toBe('2026-05-24');
  });

  it('useAppointment=false → роль из personRoles', async () => {
    const { service } = makeService({
      useAppointment: false,
      people: [
        {
          name: 'Снабженец',
          personRoles: [{ role: { name: 'Снабжение' } }],
          appointments: [],
        },
      ],
    });
    const ctx = await service.load('org-1', null);
    expect(ctx.people).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Снабженец', role: 'Снабжение' })]),
    );
  });

  it('useAppointment=true → роль из appointments', async () => {
    const { service } = makeService({
      useAppointment: true,
      people: [
        {
          name: 'Дизайнер',
          personRoles: [{ role: { name: 'СтараяРоль' } }],
          appointments: [{ role: { name: 'Дизайнер' } }],
        },
      ],
    });
    const ctx = await service.load('org-1', null);
    expect(ctx.people).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Дизайнер', role: 'Дизайнер' })]),
    );
  });

  it('нет активных ролей (обе пустые) → role:null', async () => {
    const { service } = makeService({
      useAppointment: false,
      people: [{ name: 'Без роли', personRoles: [], appointments: [] }],
    });
    const ctx = await service.load('org-1', null);
    expect(ctx.people).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Без роли', role: null })]),
    );
  });

  it('take-лимиты и фильтры: project 40 / goal 30 / person 60 + tenantId/deletedAt/archivedAt/status/relationship', async () => {
    const { service, projectFindMany, goalFindMany, personFindMany } = makeService();
    await service.load('org-77', new Date('2026-01-01T00:00:00.000Z'));

    expect(projectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'org-77', deletedAt: null, archivedAt: null },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(goalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'org-77', archivedAt: null, status: 'active' },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(personFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'org-77', deletedAt: null, relationship: 'employee' },
        take: 60,
        orderBy: { name: 'asc' },
      }),
    );
  });

  it('meetingStartedAt=null → meetingDateIso = сегодня (UTC)', async () => {
    const { service } = makeService();
    const ctx = await service.load('org-1', null);
    expect(ctx.meetingDateIso).toBe(new Date().toISOString().slice(0, 10));
  });
});
