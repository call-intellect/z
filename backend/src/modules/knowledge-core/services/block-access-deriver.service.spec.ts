import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { BlockAccessDeriverService } from './block-access-deriver.service';

/**
 * Ф3 (knowledge-access-groups-and-provenance, 2026-06-06) — юнит-тесты
 * детерминированного вывода групп доступа блока (`IdeaBlockAccess`).
 *
 * Prisma полностью замокан. Проверяем итоговый аргумент
 * `prisma.ideaBlockAccess.createMany` (via='department'|'closed', skipDuplicates)
 * либо его отсутствие (блок без скоупа → открыт).
 */

interface PrismaStub {
  ideaBlockAxisLabel: { findMany: ReturnType<typeof vi.fn> };
  functionalDomain: { findMany: ReturnType<typeof vi.fn> };
  departmentDomainLink: { findMany: ReturnType<typeof vi.fn> };
  person: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  ideaBlockEntity: { findFirst: ReturnType<typeof vi.fn> };
  meetingTypeConfig: { findUnique: ReturnType<typeof vi.fn> };
  knowledgeGroup: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  department: { findUnique: ReturnType<typeof vi.fn> };
  membership: { findMany: ReturnType<typeof vi.fn> };
  knowledgeGroupMember: { createMany: ReturnType<typeof vi.fn> };
  ideaBlockAccess: { createMany: ReturnType<typeof vi.fn> };
}

function buildPrisma(): PrismaStub {
  return {
    ideaBlockAxisLabel: { findMany: vi.fn(async () => []) },
    functionalDomain: { findMany: vi.fn(async () => []) },
    departmentDomainLink: { findMany: vi.fn(async () => []) },
    person: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    ideaBlockEntity: { findFirst: vi.fn(async () => null) },
    meetingTypeConfig: { findUnique: vi.fn(async () => null) },
    knowledgeGroup: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (a: { data: { kind: string } }) => ({
        id: `grp-${a.data.kind}`,
      })),
    },
    department: { findUnique: vi.fn(async () => ({ name: 'Логистика' })) },
    membership: { findMany: vi.fn(async () => []) },
    knowledgeGroupMember: { createMany: vi.fn(async () => ({ count: 0 })) },
    ideaBlockAccess: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
}

function buildService(prisma: PrismaStub): BlockAccessDeriverService {
  return new BlockAccessDeriverService(prisma as never);
}

describe('BlockAccessDeriverService.deriveForBlock', () => {
  it('meeting отдела «Логистика»: участник → department-группа, via=department', async () => {
    const prisma = buildPrisma();
    // Участник u1 → Person с primaryDepartmentId=dept-log.
    prisma.person.findMany.mockResolvedValueOnce([{ primaryDepartmentId: 'dept-log' }]);
    // ensureGroup(department, dept-log) — нет существующей → create вернёт id.
    prisma.knowledgeGroup.create.mockResolvedValueOnce({ id: 'g-log' });

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-1',
      sourceType: 'meeting',
      sourceExternalId: 'm-1',
      payload: { participants: [{ userId: 'u1' }] },
    });

    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ blockId: 'block-1', groupId: 'g-log', via: 'department' }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('meeting closedGroupKind=council (payload) → closed-синглтон, via=closed', async () => {
    const prisma = buildPrisma();
    prisma.knowledgeGroup.create.mockResolvedValueOnce({ id: 'g-council' });

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-2',
      sourceType: 'meeting',
      sourceExternalId: 'm-2',
      payload: { closedGroupKind: 'council' },
    });

    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ blockId: 'block-2', groupId: 'g-council', via: 'closed' }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('meeting type=interview, defaultClosedGroupKind=personal → personal-группа субъекта, via=closed', async () => {
    const prisma = buildPrisma();
    // closedGroupKind null в payload → дефолт по типу: interview→personal.
    prisma.meetingTypeConfig.findUnique.mockResolvedValueOnce({
      defaultClosedGroupKind: 'personal',
    });
    // subject-entity → Person.id для personal-группы.
    prisma.ideaBlockEntity.findFirst.mockResolvedValue({ entityId: 'ent-1' });
    prisma.person.findFirst.mockResolvedValueOnce(null); // resolveSubjectDepartment (нет отдела)
    prisma.person.findFirst.mockResolvedValueOnce({ id: 'person-1' }); // resolveSubjectPersonId
    prisma.knowledgeGroup.create.mockResolvedValueOnce({ id: 'g-personal' });

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-3',
      sourceType: 'meeting',
      sourceExternalId: 'm-3',
      payload: { type: 'interview' },
    });

    // Персональная группа создана с personId и членами.
    expect(prisma.knowledgeGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'personal', refId: 'person-1', isClosed: true }),
      }),
    );
    expect(prisma.knowledgeGroupMember.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ groupId: 'g-personal', personId: 'person-1', source: 'auto' }),
        ]),
        skipDuplicates: true,
      }),
    );
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ blockId: 'block-3', groupId: 'g-personal', via: 'closed' }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('блок без домена/участников/автора и без closed → createMany НЕ вызван (открыт)', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-4',
      sourceType: 'meeting',
      sourceExternalId: 'm-4',
      payload: { participants: [] },
    });

    expect(prisma.ideaBlockAccess.createMany).not.toHaveBeenCalled();
  });

  it('personal без разрешимого субъекта → fallback на leadership', async () => {
    const prisma = buildPrisma();
    prisma.meetingTypeConfig.findUnique.mockResolvedValueOnce({
      defaultClosedGroupKind: 'personal',
    });
    // subject не резолвится: resolveSubjectDepartment → null, resolveSubjectPersonId → null.
    prisma.ideaBlockEntity.findFirst.mockResolvedValue(null);
    prisma.knowledgeGroup.create.mockResolvedValueOnce({ id: 'g-leadership' });

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-5',
      sourceType: 'meeting',
      sourceExternalId: 'm-5',
      payload: { type: 'interview' },
    });

    // Fallback: создаётся leadership-группа (НЕ открыто).
    expect(prisma.knowledgeGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'leadership', isClosed: true }),
      }),
    );
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ blockId: 'block-5', groupId: 'g-leadership', via: 'closed' }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('K1 (Б18): гонка singleton closed-группы (refId=NULL) → P2002 → re-find существующей, без дубля', async () => {
    const prisma = buildPrisma();
    // closed=council → ensureGroup(council, refId=null): findFirst пусто →
    // create кидает P2002 (партиал-unique uq_knowledge_group_singleton) →
    // re-find находит группу-победителя гонки.
    prisma.knowledgeGroup.findFirst
      .mockResolvedValueOnce(null) // 1-й findFirst в ensureGroup
      .mockResolvedValueOnce({ id: 'g-council-existing' }); // re-find после P2002
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    prisma.knowledgeGroup.create.mockRejectedValueOnce(p2002);

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-race',
      sourceType: 'meeting',
      sourceExternalId: 'm-race',
      payload: { closedGroupKind: 'council' },
    });

    // Победитель гонки переиспользован, дубля не создано.
    expect(prisma.knowledgeGroup.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            blockId: 'block-race',
            groupId: 'g-council-existing',
            via: 'closed',
          }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it('non-meeting источник с department → closed не назначается, via=department', async () => {
    const prisma = buildPrisma();
    prisma.person.findMany.mockResolvedValueOnce([{ primaryDepartmentId: 'dept-x' }]);
    prisma.knowledgeGroup.create.mockResolvedValueOnce({ id: 'g-x' });

    const service = buildService(prisma);
    await service.deriveForBlock({
      tenantId: 'tenant-1',
      blockId: 'block-6',
      sourceType: 'tracker',
      sourceExternalId: 't-6',
      payload: { participants: [{ userId: 'ux' }], closedGroupKind: 'council' },
    });

    // closedGroupKind в payload игнорируется для non-meeting источников.
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ideaBlockAccess.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ blockId: 'block-6', groupId: 'g-x', via: 'department' }),
        ]),
        skipDuplicates: true,
      }),
    );
  });
});
