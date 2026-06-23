import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';

import type { ChatboxCustomerDto, ChatboxLinkedCustomerDto } from './dto/chatbox-customers.dto';

@Injectable()
export class ChatboxCustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

  async createCustomerAndLink(
    tenantId: string,
    userId: string,
    customerId: string,
  ): Promise<ChatboxCustomerDto> {
    const customer = await this.prisma.chatboxCustomer.findFirst({
      where: { id: customerId, tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        externalCrmId: true,
        linkedCustomerId: true,
      },
    });
    if (!customer) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_customer_not_found',
          message: 'Клиент ChatBox не найден',
        },
      });
    }
    if (customer.linkedCustomerId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_customer_already_linked',
          message: 'Клиент уже связан',
        },
      });
    }

    const { customerId: domainCustomerId } = await this.entityResolution.findOrCreateCustomerEntity(
      {
        tenantId,
        name: customer.name?.trim() || customer.email?.trim() || 'Без имени',
        email: customer.email?.trim() || null,
        phone: customer.phone?.trim() || null,
        externalCrmId: customer.externalCrmId ?? null,
        source: 'chatbox',
      },
    );

    return this.linkCustomer(tenantId, customerId, domainCustomerId);
  }

  async listCustomers(tenantId: string): Promise<ChatboxCustomerDto[]> {
    const customers = await this.prisma.chatboxCustomer.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        externalId: true,
        email: true,
        phone: true,
        name: true,
        linkMode: true,
        linkedCustomerId: true,
      },
    });

    const customerMap = await this.resolveCustomers(
      tenantId,
      customers.map((c) => c.linkedCustomerId),
    );

    return customers.map((c) => ({
      id: c.id,
      externalId: c.externalId,
      email: c.email,
      phone: c.phone,
      name: c.name,
      linkMode: c.linkMode,
      linkedCustomer: c.linkedCustomerId ? (customerMap.get(c.linkedCustomerId) ?? null) : null,
    }));
  }

  async linkCustomer(
    tenantId: string,
    chatboxCustomerId: string,
    customerId: string | null,
  ): Promise<ChatboxCustomerDto> {
    const chatboxCustomer = await this.prisma.chatboxCustomer.findFirst({
      where: { id: chatboxCustomerId, tenantId },
      select: { id: true },
    });
    if (!chatboxCustomer) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_customer_not_found',
          message: 'Клиент ChatBox не найден',
        },
      });
    }

    if (customerId !== null) {
      const domainCustomer = await this.prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!domainCustomer) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'customer_not_found', message: 'Клиент Коры не найден' },
        });
      }
    }

    const updated = await this.prisma.chatboxCustomer.update({
      where: { id: chatboxCustomerId },
      data:
        customerId !== null
          ? { linkedCustomerId: customerId, linkMode: 'manual' }
          : { linkedCustomerId: null, linkMode: 'none' },
      select: {
        id: true,
        externalId: true,
        email: true,
        phone: true,
        name: true,
        linkMode: true,
        linkedCustomerId: true,
      },
    });

    const customerMap = await this.resolveCustomers(tenantId, [updated.linkedCustomerId]);

    return {
      id: updated.id,
      externalId: updated.externalId,
      email: updated.email,
      phone: updated.phone,
      name: updated.name,
      linkMode: updated.linkMode,
      linkedCustomer: updated.linkedCustomerId
        ? (customerMap.get(updated.linkedCustomerId) ?? null)
        : null,
    };
  }

  private async resolveCustomers(
    tenantId: string,
    ids: (string | null)[],
  ): Promise<Map<string, ChatboxLinkedCustomerDto>> {
    const customerIds = [...new Set(ids.filter((id): id is string => !!id))];
    if (customerIds.length === 0) {
      return new Map();
    }
    const customers = await this.prisma.customer.findMany({
      where: { tenantId, id: { in: customerIds } },
      select: { id: true, name: true },
    });
    return new Map(customers.map((c) => [c.id, { id: c.id, name: c.name }]));
  }
}
