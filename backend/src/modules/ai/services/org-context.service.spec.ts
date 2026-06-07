import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { OrgContextService } from './org-context.service';

function makeService(args?: {
  projects?: Array<{ identifier: string; name: string }>;
  goals?: Array<{ name: string }>;
  people?: Array<{ name: string }>;
}): {
  service: OrgContextService;
  projectFindMany: ReturnType<typeof vi.fn>;
  goalFindMany: ReturnType<typeof vi.fn>;
  personFindMany: ReturnType<typeof vi.fn>;
} {
  const projectFindMany = vi
    .fn()
    .mockResolvedValue(args?.projects ?? [{ identifier: 'DEV', name: 'Команда разработки' }]);
  const goalFindMany = vi
    .fn()
    .mockResolvedValue(args?.goals ?? [{ name: 'Запуск v2' }]);
  const personFindMany = vi
    .fn()
    .mockResolvedValue(args?.people ?? [{ name: 'Иванов Сергей' }]);
  const prisma = {
    project: { findMany: projectFindMany },
    goal: { findMany: goalFindMany },
    person: { findMany: personFindMany },
  } as unknown as PrismaService;
  return {
    service: new OrgContextService(prisma),
    projectFindMany,
    goalFindMany,
    personFindMany,
  };
}

describe('OrgContextService.load', () => {
  it('возвращает {projects, goals, people, meetingDateIso} с role:null у people', async () => {
    const { service } = makeService();
    const ctx = await service.load(
      'org-1',
      new Date('2026-05-24T10:00:00.000Z'),
    );
    expect(ctx.projects).toEqual([{ identifier: 'DEV', name: 'Команда разработки' }]);
    expect(ctx.goals).toEqual([{ name: 'Запуск v2' }]);
    expect(ctx.people).toEqual([{ name: 'Иванов Сергей', role: null }]);
    expect(ctx.meetingDateIso).toBe('2026-05-24');
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
