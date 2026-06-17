import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';

import { KnowledgeAccessAdminService } from './knowledge-access-admin.service';

const TENANT = 'org-1';

interface PrismaMock {
  knowledgeGroup: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  groupVisibilityPolicy: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  knowledgeGroupMember: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  person: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  meetingTypeConfig: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function build() {
  const prisma: PrismaMock = {
    knowledgeGroup: { findFirst: vi.fn(), findMany: vi.fn() },
    groupVisibilityPolicy: {
      findMany: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    knowledgeGroupMember: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    person: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    meetingTypeConfig: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (cb: (tx: PrismaMock) => Promise<unknown>) => cb(prisma)),
  };
  const accessResolver = {
    invalidateAll: vi.fn(),
  } as unknown as KnowledgeAccessResolver;

  const svc = new KnowledgeAccessAdminService(prisma as unknown as PrismaService, accessResolver);
  return { svc, prisma, accessResolver };
}

describe('KnowledgeAccessAdminService', () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => {
    h = build();
  });

  describe('setMatrix', () => {
    it('направленно заменяет политики (delete + createMany) и зовёт invalidateAll', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({
        id: 'sales',
        kind: 'department',
      });
      h.prisma.knowledgeGroup.findMany.mockResolvedValue([
        { id: 'logistics' },
        { id: 'marketing' },
      ]);

      const out = await h.svc.setMatrix(TENANT, 'sales', ['logistics', 'marketing']);

      expect(h.prisma.groupVisibilityPolicy.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, subjectGroupId: 'sales' },
      });
      expect(h.prisma.groupVisibilityPolicy.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ subjectGroupId: 'sales', visibleGroupId: 'logistics' }),
            expect.objectContaining({ subjectGroupId: 'sales', visibleGroupId: 'marketing' }),
          ]),
        }),
      );
      expect(h.accessResolver.invalidateAll).toHaveBeenCalledTimes(1);
      expect(out).toEqual({ ok: true, count: 2 });
    });

    it('пустой список видимых = только delete (идемпотентная очистка)', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'sales', kind: 'department' });

      const out = await h.svc.setMatrix(TENANT, 'sales', []);

      expect(h.prisma.groupVisibilityPolicy.deleteMany).toHaveBeenCalledTimes(1);
      expect(h.prisma.groupVisibilityPolicy.createMany).not.toHaveBeenCalled();
      expect(out).toEqual({ ok: true, count: 0 });
    });

    it('чужой/несуществующий subjectGroupId → NotFoundException (tenant-scope)', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue(null);
      await expect(h.svc.setMatrix(TENANT, 'other-org-group', ['x'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.accessResolver.invalidateAll).not.toHaveBeenCalled();
    });

    it('subject не department → BadRequest', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council', kind: 'council' });
      await expect(h.svc.setMatrix(TENANT, 'council', ['x'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('visible-группа не отдел/не из Org → BadRequest', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'sales', kind: 'department' });
      h.prisma.knowledgeGroup.findMany.mockResolvedValue([{ id: 'logistics' }]);
      await expect(
        h.svc.setMatrix(TENANT, 'sales', ['logistics', 'foreign']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('addMember', () => {
    it('новый член → create + invalidateAll, added=true', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council' });
      h.prisma.person.findFirst.mockResolvedValue({ id: 'p-1' });
      h.prisma.knowledgeGroupMember.findUnique.mockResolvedValue(null);

      const out = await h.svc.addMember(TENANT, 'council', 'p-1');

      expect(h.prisma.knowledgeGroupMember.create).toHaveBeenCalledWith({
        data: { groupId: 'council', personId: 'p-1', source: 'manual' },
      });
      expect(h.accessResolver.invalidateAll).toHaveBeenCalledTimes(1);
      expect(out).toEqual({ ok: true, added: true });
    });

    it('повтор существующего члена → no-op, added=false, без create', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council' });
      h.prisma.person.findFirst.mockResolvedValue({ id: 'p-1' });
      h.prisma.knowledgeGroupMember.findUnique.mockResolvedValue({ groupId: 'council' });

      const out = await h.svc.addMember(TENANT, 'council', 'p-1');

      expect(h.prisma.knowledgeGroupMember.create).not.toHaveBeenCalled();
      expect(h.accessResolver.invalidateAll).not.toHaveBeenCalled();
      expect(out).toEqual({ ok: true, added: false });
    });

    it('чужая группа → NotFound', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue(null);
      await expect(h.svc.addMember(TENANT, 'foreign', 'p-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('чужой/несуществующий person → NotFound', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council' });
      h.prisma.person.findFirst.mockResolvedValue(null);
      await expect(h.svc.addMember(TENANT, 'council', 'foreign-p')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('removeMember', () => {
    it('убирает члена + invalidateAll, removed=true', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council' });
      h.prisma.knowledgeGroupMember.deleteMany.mockResolvedValue({ count: 1 });

      const out = await h.svc.removeMember(TENANT, 'council', 'p-1');

      expect(h.prisma.knowledgeGroupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'council', personId: 'p-1' },
      });
      expect(h.accessResolver.invalidateAll).toHaveBeenCalledTimes(1);
      expect(out).toEqual({ ok: true, removed: true });
    });

    it('нет такой строки → removed=false (идемпотентно)', async () => {
      h.prisma.knowledgeGroup.findFirst.mockResolvedValue({ id: 'council' });
      h.prisma.knowledgeGroupMember.deleteMany.mockResolvedValue({ count: 0 });
      const out = await h.svc.removeMember(TENANT, 'council', 'p-x');
      expect(out).toEqual({ ok: true, removed: false });
    });
  });

  describe('setMeetingTypeClosedDefault', () => {
    it('обновляет defaultClosedGroupKind + updatedBy', async () => {
      h.prisma.meetingTypeConfig.findUnique.mockResolvedValue({ id: 'interview' });

      const out = await h.svc.setMeetingTypeClosedDefault('interview', 'personal', 'admin-1');

      expect(h.prisma.meetingTypeConfig.update).toHaveBeenCalledWith({
        where: { id: 'interview' },
        data: { defaultClosedGroupKind: 'personal', updatedBy: 'admin-1' },
      });
      expect(out).toEqual({
        ok: true,
        typeId: 'interview',
        defaultClosedGroupKind: 'personal',
      });
    });

    it('null = снять закрытость', async () => {
      h.prisma.meetingTypeConfig.findUnique.mockResolvedValue({ id: 'sales' });
      await h.svc.setMeetingTypeClosedDefault('sales', null, 'admin-1');
      expect(h.prisma.meetingTypeConfig.update).toHaveBeenCalledWith({
        where: { id: 'sales' },
        data: { defaultClosedGroupKind: null, updatedBy: 'admin-1' },
      });
    });

    it('несуществующий тип → NotFound', async () => {
      h.prisma.meetingTypeConfig.findUnique.mockResolvedValue(null);
      await expect(
        h.svc.setMeetingTypeClosedDefault('nope', 'council', 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listGroups / getMatrix / listMembers', () => {
    it('listGroups мапит memberCount из _count', async () => {
      h.prisma.knowledgeGroup.findMany.mockResolvedValue([
        {
          id: 'g1',
          kind: 'department',
          name: 'Логистика',
          isClosed: false,
          refId: 'dep-1',
          _count: { members: 3 },
        },
      ]);
      const out = await h.svc.listGroups(TENANT);
      expect(out.items[0]).toEqual(
        expect.objectContaining({ id: 'g1', name: 'Логистика', memberCount: 3 }),
      );
    });

    it('getMatrix добавляет имена групп', async () => {
      h.prisma.groupVisibilityPolicy.findMany.mockResolvedValue([
        { subjectGroupId: 'sales', visibleGroupId: 'logistics' },
      ]);
      h.prisma.knowledgeGroup.findMany.mockResolvedValue([
        { id: 'sales', name: 'Продажи' },
        { id: 'logistics', name: 'Логистика' },
      ]);
      const out = await h.svc.getMatrix(TENANT);
      expect(out.items[0]).toEqual({
        subjectGroupId: 'sales',
        subjectGroupName: 'Продажи',
        visibleGroupId: 'logistics',
        visibleGroupName: 'Логистика',
      });
    });
  });
});
