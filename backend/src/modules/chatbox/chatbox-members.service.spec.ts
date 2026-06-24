import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { PersonsService } from '../persons/services/persons.service';

import { ChatboxMembersService } from './chatbox-members.service';

describe('ChatboxMembersService', () => {
  let prismaMock: {
    chatboxMember: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    person: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let service: ChatboxMembersService;

  beforeEach(() => {
    prismaMock = {
      chatboxMember: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      person: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const personsMock = {
      create: vi.fn(),
    };
    service = new ChatboxMembersService(
      prismaMock as unknown as PrismaService,
      personsMock as unknown as PersonsService,
    );
  });

  describe('listMembers', () => {
    it('батч-резолв связанной Person (один findMany, без N+1) + форма DTO', async () => {
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          externalId: 'e1',
          email: 'a@x.ru',
          name: 'Alice',
          role: 'MANAGER',
          linkMode: 'auto',
          linkedPersonId: 'p1',
        },
        {
          id: 'm2',
          externalId: 'e2',
          email: 'b@x.ru',
          name: 'Bob',
          role: 'USER',
          linkMode: 'manual',
          linkedPersonId: 'p1',
        },
        {
          id: 'm3',
          externalId: 'e3',
          email: null,
          name: 'Carol',
          role: null,
          linkMode: 'none',
          linkedPersonId: null,
        },
      ]);
      prismaMock.person.findMany.mockResolvedValue([{ id: 'p1', name: 'Person One' }]);

      const res = await service.listMembers('t1');

      expect(prismaMock.person.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.person.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', id: { in: ['p1'] } },
        }),
      );

      expect(res).toEqual([
        expect.objectContaining({
          id: 'm1',
          externalId: 'e1',
          email: 'a@x.ru',
          name: 'Alice',
          role: 'MANAGER',
          linkMode: 'auto',
          linkedPerson: { id: 'p1', name: 'Person One' },
        }),
        expect.objectContaining({
          id: 'm2',
          linkMode: 'manual',
          linkedPerson: { id: 'p1', name: 'Person One' },
        }),
        expect.objectContaining({
          id: 'm3',
          linkMode: 'none',
          linkedPerson: null,
        }),
      ]);
    });

    it('нет связанных Person → findMany Person не вызывается', async () => {
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          externalId: 'e1',
          email: 'a@x.ru',
          name: 'Alice',
          role: null,
          linkMode: 'none',
          linkedPersonId: null,
        },
      ]);

      const res = await service.listMembers('t1');

      expect(prismaMock.person.findMany).not.toHaveBeenCalled();
      expect(res[0]).toEqual(expect.objectContaining({ id: 'm1', linkedPerson: null }));
    });
  });

  describe('linkMember', () => {
    it('personId задан, Person существует → update linkMode=manual + linkedPersonId', async () => {
      prismaMock.chatboxMember.findFirst.mockResolvedValue({ id: 'm1' });
      prismaMock.person.findFirst.mockResolvedValue({ id: 'p1' });
      prismaMock.chatboxMember.update.mockResolvedValue({
        id: 'm1',
        externalId: 'e1',
        email: 'a@x.ru',
        name: 'Alice',
        role: 'MANAGER',
        linkMode: 'manual',
        linkedPersonId: 'p1',
      });
      prismaMock.person.findMany.mockResolvedValue([{ id: 'p1', name: 'Person One' }]);

      const res = await service.linkMember('t1', 'm1', 'p1');

      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { linkedPersonId: 'p1', linkMode: 'manual' },
        }),
      );
      expect(prismaMock.person.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'p1', relationship: 'external' }),
          data: { relationship: 'employee' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          id: 'm1',
          linkMode: 'manual',
          linkedPerson: { id: 'p1', name: 'Person One' },
        }),
      );
    });

    it('personId задан, Person отсутствует → person_not_found', async () => {
      prismaMock.chatboxMember.findFirst.mockResolvedValue({ id: 'm1' });
      prismaMock.person.findFirst.mockResolvedValue(null);

      await expect(service.linkMember('t1', 'm1', 'p404')).rejects.toThrow(BadRequestException);
      expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    });

    it('personId=null → update linkMode=none, linkedPersonId=null', async () => {
      prismaMock.chatboxMember.findFirst.mockResolvedValue({ id: 'm1' });
      prismaMock.chatboxMember.update.mockResolvedValue({
        id: 'm1',
        externalId: 'e1',
        email: 'a@x.ru',
        name: 'Alice',
        role: 'MANAGER',
        linkMode: 'none',
        linkedPersonId: null,
      });

      const res = await service.linkMember('t1', 'm1', null);

      expect(prismaMock.person.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { linkedPersonId: null, linkMode: 'none' },
        }),
      );
      expect(res).toEqual(expect.objectContaining({ linkMode: 'none', linkedPerson: null }));
    });

    it('член не найден → chatbox_member_not_found', async () => {
      prismaMock.chatboxMember.findFirst.mockResolvedValue(null);

      await expect(service.linkMember('t1', 'm404', 'p1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.person.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
    });
  });

  describe('autoLinkUnlinked', () => {
    it('email уже есть у Person → linked++, create НЕ вызван, linkMode=auto', async () => {
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'm1', name: 'Alice', email: 'a@x.ru' },
      ]);
      prismaMock.person.findFirst.mockResolvedValue({ id: 'p-exist' });

      const res = await service.autoLinkUnlinked('t1');

      expect(prismaMock.chatboxMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', linkedPersonId: null },
        }),
      );
      expect(prismaMock.person.create).not.toHaveBeenCalled();
      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { linkedPersonId: 'p-exist', linkMode: 'auto' },
        }),
      );
      expect(prismaMock.person.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'p-exist', relationship: 'external' }),
          data: { relationship: 'employee' },
        }),
      );
      expect(res).toEqual({ created: 0, linked: 1 });
    });

    it('email без Person → create relationship=employee, created++, linkMode=auto', async () => {
      prismaMock.chatboxMember.findMany.mockResolvedValue([
        { id: 'm1', name: 'Bob', email: 'b@x.ru' },
      ]);
      prismaMock.person.findFirst.mockResolvedValue(null);
      prismaMock.person.create.mockResolvedValue({ id: 'p-new' });

      const res = await service.autoLinkUnlinked('t1');

      expect(prismaMock.person.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            name: 'Bob',
            email: 'b@x.ru',
            relationship: 'employee',
          }),
        }),
      );
      expect(prismaMock.chatboxMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { linkedPersonId: 'p-new', linkMode: 'auto' },
        }),
      );
      expect(res).toEqual({ created: 1, linked: 0 });
    });

    it('нет unlinked-строк → no-op', async () => {
      prismaMock.chatboxMember.findMany.mockResolvedValue([]);

      const res = await service.autoLinkUnlinked('t1');

      expect(prismaMock.person.create).not.toHaveBeenCalled();
      expect(prismaMock.chatboxMember.update).not.toHaveBeenCalled();
      expect(res).toEqual({ created: 0, linked: 0 });
    });
  });
});
