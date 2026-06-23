import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';

import { ChatboxCustomersService } from './chatbox-customers.service';

describe('ChatboxCustomersService', () => {
  let prismaMock: {
    chatboxCustomer: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    customer: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let entityResolutionMock: { findOrCreateCustomerEntity: ReturnType<typeof vi.fn> };
  let service: ChatboxCustomersService;

  beforeEach(() => {
    prismaMock = {
      chatboxCustomer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      customer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    entityResolutionMock = { findOrCreateCustomerEntity: vi.fn() };
    service = new ChatboxCustomersService(
      prismaMock as unknown as PrismaService,
      entityResolutionMock as unknown as EntityResolutionService,
    );
  });

  describe('listCustomers', () => {
    it('батч-резолв связанного клиента Коры (один findMany, без N+1) + форма DTO', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        {
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: '+7900',
          name: 'Клиент A',
          linkMode: 'manual',
          linkedCustomerId: 'cust1',
        },
        {
          id: 'c2',
          externalId: 'e2',
          email: null,
          phone: null,
          name: 'Клиент B',
          linkMode: 'none',
          linkedCustomerId: null,
        },
      ]);
      prismaMock.customer.findMany.mockResolvedValue([{ id: 'cust1', name: 'Клиент Коры' }]);

      const res = await service.listCustomers('t1');

      expect(prismaMock.customer.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', id: { in: ['cust1'] } },
        }),
      );

      expect(res).toEqual([
        expect.objectContaining({
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: '+7900',
          name: 'Клиент A',
          linkMode: 'manual',
          linkedCustomer: { id: 'cust1', name: 'Клиент Коры' },
        }),
        expect.objectContaining({
          id: 'c2',
          linkMode: 'none',
          linkedCustomer: null,
        }),
      ]);
    });

    it('нет связанных клиентов → findMany Customer не вызывается', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        {
          id: 'c1',
          externalId: 'e1',
          email: 'a@x.ru',
          phone: null,
          name: 'Клиент',
          linkMode: 'none',
          linkedCustomerId: null,
        },
      ]);

      const res = await service.listCustomers('t1');

      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
      expect(res[0]).toEqual(expect.objectContaining({ id: 'c1', linkedCustomer: null }));
    });
  });

  describe('linkCustomer', () => {
    it('customerId задан, клиент Коры существует → update linkMode=manual + linkedCustomerId', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: null,
        name: 'Клиент',
        linkMode: 'manual',
        linkedCustomerId: 'cust1',
      });
      prismaMock.customer.findMany.mockResolvedValue([{ id: 'cust1', name: 'Клиент Коры' }]);

      const res = await service.linkCustomer('t1', 'c1', 'cust1');

      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: { linkedCustomerId: 'cust1', linkMode: 'manual' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          id: 'c1',
          linkMode: 'manual',
          linkedCustomer: { id: 'cust1', name: 'Клиент Коры' },
        }),
      );
    });

    it('customerId задан, клиент Коры отсутствует → customer_not_found', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(service.linkCustomer('t1', 'c1', 'cust404')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    });

    it('customerId=null → update linkMode=none, linkedCustomerId=null', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: null,
        name: 'Клиент',
        linkMode: 'none',
        linkedCustomerId: null,
      });

      const res = await service.linkCustomer('t1', 'c1', null);

      expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: { linkedCustomerId: null, linkMode: 'none' },
        }),
      );
      expect(res).toEqual(expect.objectContaining({ linkMode: 'none', linkedCustomer: null }));
    });

    it('клиент ChatBox не найден → chatbox_customer_not_found', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue(null);

      await expect(service.linkCustomer('t1', 'c404', 'cust1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
    });
  });

  describe('createCustomerAndLink', () => {
    it('happy: резолвит клиента Коры через EntityResolution и связывает, linkMode=manual', async () => {
      prismaMock.chatboxCustomer.findFirst
        .mockResolvedValueOnce({
          id: 'c1',
          name: 'Клиент',
          email: 'a@x.ru',
          phone: '+7900',
          externalCrmId: 'crm1',
          linkedCustomerId: null,
        })
        .mockResolvedValueOnce({ id: 'c1' });
      entityResolutionMock.findOrCreateCustomerEntity.mockResolvedValue({
        customerId: 'cust-new',
        created: true,
      });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'cust-new' });
      prismaMock.chatboxCustomer.update.mockResolvedValue({
        id: 'c1',
        externalId: 'e1',
        email: 'a@x.ru',
        phone: '+7900',
        name: 'Клиент',
        linkMode: 'manual',
        linkedCustomerId: 'cust-new',
      });
      prismaMock.customer.findMany.mockResolvedValue([{ id: 'cust-new', name: 'Клиент' }]);

      const res = await service.createCustomerAndLink('t1', 'u1', 'c1');

      expect(entityResolutionMock.findOrCreateCustomerEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          name: 'Клиент',
          email: 'a@x.ru',
          phone: '+7900',
          externalCrmId: 'crm1',
          source: 'chatbox',
        }),
      );
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedCustomerId: 'cust-new', linkMode: 'manual' },
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({
          linkMode: 'manual',
          linkedCustomer: { id: 'cust-new', name: 'Клиент' },
        }),
      );
    });

    it('клиент уже связан → chatbox_customer_already_linked', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue({
        id: 'c1',
        name: 'Клиент',
        email: 'a@x.ru',
        phone: null,
        externalCrmId: null,
        linkedCustomerId: 'cust1',
      });

      await expect(service.createCustomerAndLink('t1', 'u1', 'c1')).rejects.toThrow(
        BadRequestException,
      );
      expect(entityResolutionMock.findOrCreateCustomerEntity).not.toHaveBeenCalled();
    });

    it('клиент ChatBox не найден → chatbox_customer_not_found', async () => {
      prismaMock.chatboxCustomer.findFirst.mockResolvedValue(null);

      await expect(service.createCustomerAndLink('t1', 'u1', 'c404')).rejects.toThrow(
        BadRequestException,
      );
      expect(entityResolutionMock.findOrCreateCustomerEntity).not.toHaveBeenCalled();
    });
  });
});
