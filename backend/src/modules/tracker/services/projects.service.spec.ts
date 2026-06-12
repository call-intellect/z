import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateProjectDto } from '../dto/projects/create-project.dto';

import { ProjectsService } from './projects.service';

/**
 * D2 (ТЗ 2026-06-11) — серверная автогенерация slug/identifier. Тонкий тест на
 * ветку «не переданы → генерим из name»; полный collision-харнесс утилит уже
 * покрыт `translit.spec.ts`.
 */

const baseDto: CreateProjectDto = {
  name: 'Маркетинг',
  network: 0,
  timezone: 'Europe/Moscow',
  cycleViewEnabled: true,
  intakeViewEnabled: true,
  gantViewEnabled: false,
  timeTrackingEnabled: false,
} as CreateProjectDto;

function mockProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prj1',
    tenantId: 'org1',
    slug: 'marketing',
    identifier: 'MARKE',
    name: 'Маркетинг',
    description: null,
    ownerId: 'u1',
    defaultAssigneeId: null,
    network: 0,
    timezone: 'Europe/Moscow',
    cycleViewEnabled: true,
    intakeViewEnabled: true,
    gantViewEnabled: false,
    timeTrackingEnabled: false,
    teamTemplateId: null,
    customerCardId: null,
    vendorId: null,
    subjectPersonId: null,
    departmentId: null,
    defaultStateId: 's1',
    archivedAt: null,
    createdAt: new Date('2026-06-11T00:00:00Z'),
    updatedAt: new Date('2026-06-11T00:00:00Z'),
    ...over,
  };
}

describe('ProjectsService.create — автогенерация slug/identifier (D2)', () => {
  it('slug/identifier не переданы → генерит из name; pre-check findUnique НЕ зовётся', async () => {
    const createSpy = vi.fn(async (args: { data: Record<string, unknown> }) =>
      mockProject(args.data),
    );
    const topFindUnique = vi.fn();
    const txFindUnique = vi.fn(async () => null); // generateProjectSlug — нет коллизии
    const txFindFirst = vi.fn(async () => null); // generateProjectIdentifier — нет коллизии
    const tx = {
      project: {
        create: createSpy,
        findUnique: txFindUnique,
        findFirst: txFindFirst,
        update: vi.fn(async (a: { data: Record<string, unknown> }) => mockProject(a.data)),
      },
      issueState: {
        createManyAndReturn: vi.fn(async () => [{ id: 's1', isDefault: true }]),
      },
      projectMember: { create: vi.fn(async () => ({})) },
      board: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      project: { findUnique: topFindUnique },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaService;

    const svc = new ProjectsService(prisma);
    await svc.create(baseDto, 'org1', 'u1');

    expect(topFindUnique).not.toHaveBeenCalled();
    expect(txFindUnique).toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'marketing',
          identifier: expect.stringMatching(/^[A-Z][A-Z0-9]{1,4}$/),
        }),
      }),
    );
  });

  it('явный занятый slug → 409 project_slug_taken (поведение сохранено)', async () => {
    const topFindUnique = vi.fn(async () => ({ id: 'existing' }));
    const prisma = {
      project: { findUnique: topFindUnique },
      $transaction: vi.fn(),
    } as unknown as PrismaService;

    const svc = new ProjectsService(prisma);
    await expect(
      svc.create({ ...baseDto, slug: 'taken' } as CreateProjectDto, 'org1', 'u1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'project_slug_taken' } },
    });
  });
});
