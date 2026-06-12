import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { PersonsService } from '../persons/services/persons.service';

import { ChatboxCustomersService } from './chatbox-customers.service';

/**
 * Unit-тесты ChatboxCustomersService с замоканным prisma (БД нет). Клон тестов
 * ChatboxMembersService: батч-резолв Person (без N+1), форма DTO и ветки
 * linkCustomer (manual / none / not-found) + createPersonAndLink (дедуп по email).
 */

describe('ChatboxCustomersService', () => {
  let prismaMock: {
    chatboxCustomer: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    person: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let personsMock: { create: ReturnType<typeof vi.fn> };
  let service: ChatboxCustomersService;

  beforeEach(() => {
    prismaMock = {
      chatboxCustomer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      person: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    personsMock = { create: vi.fn() };
    service = new ChatboxCustomersService(
      prismaMock as unknown as PrismaService,
      personsMock as unknown as PersonsService,
    );
  });

  describe('listCustomers', () => {
    it('батч-резолв связанной Person (один findMany, без N+1) + форма DTO', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        {
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: '+7900',
          name: 'Клиент A',
          linkMode: 'auto',
          linkedPersonId: 'p1',
        },
        {
          id: 'c2',
          externalId: 'e2',
          email: null,
          phone: null,
          name: 'Клиент B',
          linkMode: 'none',
          linkedPersonId: null,
        },
      ]);
      prismaMock.person.findMany.mockResolvedValue([
        { id: 'p1', name: 'Person One' },
      ]);

      const res = await service.listCustomers('t1');

      expect(prismaMock.person.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.person.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', id: { in: ['p1'] } },
        }),
      );

      expect(res).toEqual([
        expect.objectContaining({
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: '+7900',
          name: 'Клиент A',
          linkMode: 'auto',
          linkedPerson: { id: 'p1', name: 'Person One' },
        }),
        expect.objectContaining({
          id: 'c2',
          linkMode: 'none',
          linkedPerson: null,
        }),
      ]);
    });

    it('нет связанных Person → findMany Person не вызывается', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        {
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: null,
          name: 'Клиент',
          linkMode: 'none',
          linkedPersonId: null,
        },
      ]);

      const res = await service.listCustomers('t1');

      expect(prismaMock.person.findMany).not.toHaveBeenCalled();
      expect(res[0]).toEqual(
        expect.objectContaining({ id: 'c1', linkedPerson: null }),
      );
    });
  });

  describe('linkCustomer', () => {
    it('personId задан, Person существует → update linkMode=manual + linkedPersonId', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.person.findFirst.mockResolvedValue({ id: 'p1' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: null,
        name: 'Клиент',
        linkMode: 'manual',
        linkedPersonId: 'p1',
      });
      prismaMock.person.findMany.mockResolvedValue([
        { id: 'p1', name: 'Person One' },
      ]);

      const res = await service.linkCustomer('t1', 'c1', 'p1');

      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: { linkedPersonId: 'p1', linkMode: 'manual' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          id: 'c1',
          linkMode: 'manual',
          linkedPerson: { id: 'p1', name: 'Person One' },
        }),
      );
    });

    it('personId задан, Person отсутствует → person_not_found', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.person.findFirst.mockResolvedValue(null);

      await expect(service.linkCustomer('t1', 'c1', 'p404')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    });

    it('personId=null → update linkMode=none, linkedPersonId=null', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: null,
        name: 'Клиент',
        linkMode: 'none',
        linkedPersonId: null,
      });

      const res = await service.linkCustomer('t1', 'c1', null);

      expect(prismaMock.person.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: { linkedPersonId: null, linkMode: 'none' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({ linkMode: 'none', linkedPerson: null }),
      );
    });

    it('клиент не найден → chatbox_customer_not_found', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue(null);

      await expect(service.linkCustomer('t1', 'c404', 'p1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.person.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    });
  });

  describe('createPersonAndLink', () => {
    it('email уже есть у Person → связываем существующего (не плодим), linkMode=manual', async () => {
      prismaMock.chatboxCustomer.findFirst
        // 1-й вызов — внутри createPersonAndLink.
        .mockResolvedValueOnce({
          id: 'c1',
          name: 'Клиент',
          email: 'a@x.ru',
          linkedPersonId: null,
        })
        // 2-й вызов — внутри linkCustomer.
        .mockResolvedValueOnce({ id: 'c1' });
      // Дедуп по email: Person существует.
      prismaMock.person.findFirst
        .mockResolvedValueOnce({ id: 'p-existing' }) // дедуп
        .mockResolvedValueOnce({ id: 'p-existing' }); // проверка в linkCustomer
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: null,
        name: 'Клиент',
        linkMode: 'manual',
        linkedPersonId: 'p-existing',
      });
      prismaMock.person.findMany.mockResolvedValue([
        { id: 'p-existing', name: 'Существующий' },
      ]);

      const res = await service.createPersonAndLink('t1', 'u1', 'c1');

      // Нового Person не создавали.
      expect(personsMock.create).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedPersonId: 'p-existing', linkMode: 'manual' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({ linkMode: 'manual' }),
      );
    });

    it('клиент уже связан → chatbox_customer_already_linked', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Клиент',
        email: 'a@x.ru',
        linkedPersonId: 'p1',
      });

      await expect(
        service.createPersonAndLink('t1', 'u1', 'c1'),
      ).rejects.toThrow(BadRequestException);
      expect(personsMock.create).not.toHaveBeenCalled();
    });

    it('email нет у Person → создаём карточку через PersonsService и связываем', async () => {
      prismaMock.chatboxCustomer.findFirst
        .mockResolvedValueOnce({
          id: 'c1',
          name: 'Клиент Без Почты',
          email: null,
          linkedPersonId: null,
        })
        .mockResolvedValueOnce({ id: 'c1' });
      personsMock.create.mockResolvedValue({ id: 'p-new' });
      prismaMock.person.findFirst.mockResolvedValue({ id: 'p-new' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: null,
        phone: null,
        name: 'Клиент Без Почты',
        linkMode: 'manual',
        linkedPersonId: 'p-new',
      });
      prismaMock.person.findMany.mockResolvedValue([
        { id: 'p-new', name: 'Клиент Без Почты' },
      ]);

      const res = await service.createPersonAndLink('t1', 'u1', 'c1');

      expect(personsMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          userId: 'u1',
          body: expect.objectContaining({ name: 'Клиент Без Почты' }),
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          linkMode: 'manual',
          linkedPerson: { id: 'p-new', name: 'Клиент Без Почты' },
        }),
      );
    });
  });
});
