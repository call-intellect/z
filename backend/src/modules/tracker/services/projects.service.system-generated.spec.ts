import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ListProjectsQuery } from '../dto/projects/list-projects-query.dto';

import { ProjectsService } from './projects.service';

/**
 * A6 (2026-06-06) — unit-тест фильтра системных проектов в `findAll`.
 *
 * Покрытие:
 *   org-контейнеры «Спринт компании» (Project.systemGenerated=true) скрыты
 *   из `GET /projects` — `findAll` всегда строит `where` с
 *   `systemGenerated: false`, и для findMany, и для count.
 *
 * ТЗ: A6 (скрыть теневой проект «Спринт компании» из GET /projects).
 */
describe('ProjectsService.findAll — фильтр systemGenerated', () => {
  const tenantId = 'org_1';

  let projectFindMany: ReturnType<typeof vi.fn>;
  let projectCount: ReturnType<typeof vi.fn>;
  let prisma: PrismaService;
  let service: ProjectsService;

  beforeEach(() => {
    projectFindMany = vi.fn().mockResolvedValue([]);
    projectCount = vi.fn().mockResolvedValue(0);

    prisma = {
      project: {
        findMany: projectFindMany,
        count: projectCount,
      },
    } as unknown as PrismaService;

    service = new ProjectsService(prisma);
  });

  const baseQuery: ListProjectsQuery = {
    includeArchived: false,
    page: 1,
    limit: 50,
  };

  it('строит where с systemGenerated:false и для findMany, и для count', async () => {
    const result = await service.findAll(tenantId, baseQuery);

    expect(result).toEqual({ items: [], total: 0 });

    expect(projectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          deletedAt: null,
          systemGenerated: false,
        }),
      }),
    );

    expect(projectCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          systemGenerated: false,
        }),
      }),
    );
  });

  it('сохраняет systemGenerated:false при includeArchived и поиске', async () => {
    await service.findAll(tenantId, {
      ...baseQuery,
      includeArchived: true,
      q: 'спринт',
    });

    expect(projectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          systemGenerated: false,
        }),
      }),
    );
  });
});
