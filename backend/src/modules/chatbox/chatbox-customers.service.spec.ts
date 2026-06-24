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
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    chatboxChannelClient: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    customer: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    entityLink: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let entityResolutionMock: {
    findOrCreateCustomerEntity: ReturnType<typeof vi.fn>;
    findOrCreateEntity: ReturnType<typeof vi.fn>;
  };
  let service: ChatboxCustomersService;

  beforeEach(() => {
    prismaMock = {
      chatboxCustomer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      chatboxChannelClient: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      customer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      entityLink: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    entityResolutionMock = {
      findOrCreateCustomerEntity: vi.fn(),
      findOrCreateEntity: vi.fn(),
    };
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

  describe('autoLinkUnlinked', () => {
    it('unlinked-строка → резолвит сущность и ставит linkMode=auto', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        { id: 'c1', name: 'Клиент', email: 'a@x.ru', phone: '+7900', externalCrmId: 'crm1' },
      ]);
      entityResolutionMock.findOrCreateCustomerEntity.mockResolvedValue({
        customerId: 'cust-new',
        created: true,
      });

      const res = await service.autoLinkUnlinked('t1');

      expect(prismaMock.chatboxCustomer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', linkedCustomerId: null },
        }),
      );
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
          where: { id: 'c1' },
          data: { linkedCustomerId: 'cust-new', linkMode: 'auto' },
        }),
      );
      expect(res).toEqual({ created: 1, linked: 0 });
    });

    it('резолвер вернул created=false → счётчик linked++', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([
        { id: 'c1', name: 'Клиент', email: null, phone: null, externalCrmId: null },
      ]);
      entityResolutionMock.findOrCreateCustomerEntity.mockResolvedValue({
        customerId: 'cust-exist',
        created: false,
      });

      const res = await service.autoLinkUnlinked('t1');

      expect(res).toEqual({ created: 0, linked: 1 });
      expect(prismaMock.chatboxCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { linkedCustomerId: 'cust-exist', linkMode: 'auto' },
        }),
      );
    });

    it('нет unlinked-строк → no-op (резолвер не зовётся)', async () => {
      prismaMock.chatboxCustomer.findMany.mockResolvedValue([]);

      const res = await service.autoLinkUnlinked('t1');

      expect(entityResolutionMock.findOrCreateCustomerEntity).not.toHaveBeenCalled();
      expect(prismaMock.chatboxCustomer.update).not.toHaveBeenCalled();
      expect(res).toEqual({ created: 0, linked: 0 });
    });
  });

  describe('autoLinkChannelClients', () => {
    it('unlinked channel-client → findOrCreateEntity(person) + linkedContactEntityId; без customerId works_at не создаётся', async () => {
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([
        { id: 'cc1', externalId: 'tg-1', name: 'Собеседник', email: 'cc@x.ru', customerId: null },
      ]);
      entityResolutionMock.findOrCreateEntity.mockResolvedValue({
        entity: { id: 'ent-new' },
        created: true,
      });

      const res = await service.autoLinkChannelClients('t1');

      expect(prismaMock.chatboxChannelClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', linkedContactEntityId: null },
        }),
      );
      expect(entityResolutionMock.findOrCreateEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          type: 'person',
          name: 'Собеседник',
          email: 'cc@x.ru',
        }),
      );
      expect(prismaMock.chatboxChannelClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cc1' },
          data: { linkedContactEntityId: 'ent-new' },
        }),
      );
      expect(prismaMock.entityLink.create).not.toHaveBeenCalled();
      expect(res).toEqual({ created: 1, linked: 0 });
    });

    it('customerId с привязанным аккаунтом → создаётся EntityLink works_at контакт→аккаунт', async () => {
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([
        { id: 'cc1', externalId: 'tg-1', name: 'Контакт', email: null, customerId: 'cust-ref' },
      ]);
      entityResolutionMock.findOrCreateEntity.mockResolvedValue({
        entity: { id: 'ent-contact' },
        created: false,
      });
      prismaMock.chatboxCustomer.findUnique.mockResolvedValue({ linkedCustomerId: 'kora-cust' });
      prismaMock.customer.findUnique.mockResolvedValue({ entityId: 'acc-ent' });
      prismaMock.entityLink.findFirst.mockResolvedValue(null);

      const res = await service.autoLinkChannelClients('t1');

      expect(entityResolutionMock.findOrCreateEntity).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', type: 'person', name: 'Контакт' }),
      );
      expect(prismaMock.entityLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            fromEntityId: 'ent-contact',
            toEntityId: 'acc-ent',
            fromType: 'entity',
            toType: 'entity',
            relationType: 'works_at',
            createdBy: 'manual',
            status: 'active',
          }),
        }),
      );
      expect(res).toEqual({ created: 0, linked: 1 });
    });

    it('EntityLink works_at уже существует → не дублируется', async () => {
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([
        { id: 'cc1', externalId: 'tg-1', name: 'Контакт', email: null, customerId: 'cust-ref' },
      ]);
      entityResolutionMock.findOrCreateEntity.mockResolvedValue({
        entity: { id: 'ent-contact' },
        created: false,
      });
      prismaMock.chatboxCustomer.findUnique.mockResolvedValue({ linkedCustomerId: 'kora-cust' });
      prismaMock.customer.findUnique.mockResolvedValue({ entityId: 'acc-ent' });
      prismaMock.entityLink.findFirst.mockResolvedValue({ id: 'link-existing' });

      await service.autoLinkChannelClients('t1');

      expect(prismaMock.entityLink.create).not.toHaveBeenCalled();
    });

    it('name пустой → fallback на externalId', async () => {
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([
        { id: 'cc1', externalId: 'tg-42', name: '  ', email: null, customerId: null },
      ]);
      entityResolutionMock.findOrCreateEntity.mockResolvedValue({
        entity: { id: 'ent-new' },
        created: true,
      });

      await service.autoLinkChannelClients('t1');

      expect(entityResolutionMock.findOrCreateEntity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tg-42' }),
      );
    });

    it('нет unlinked channel-client → no-op (резолвер не зовётся)', async () => {
      prismaMock.chatboxChannelClient.findMany.mockResolvedValue([]);

      const res = await service.autoLinkChannelClients('t1');

      expect(entityResolutionMock.findOrCreateEntity).not.toHaveBeenCalled();
      expect(prismaMock.chatboxChannelClient.update).not.toHaveBeenCalled();
      expect(prismaMock.entityLink.create).not.toHaveBeenCalled();
      expect(res).toEqual({ created: 0, linked: 0 });
    });
  });
});
