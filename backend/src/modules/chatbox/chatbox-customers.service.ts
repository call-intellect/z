import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { PersonsService } from '../persons/services/persons.service';

import type { ChatboxCustomerDto, ChatboxLinkedPersonDto } from './dto/chatbox-customers.dto';

@Injectable()
export class ChatboxCustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

  async createPersonAndLink(
    tenantId: string,
    userId: string,
    customerId: string,
  ): Promise<ChatboxCustomerDto> {
    const customer = await this.prisma.chatboxCustomer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, name: true, email: true, linkedPersonId: true },
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
    if (customer.linkedPersonId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_customer_already_linked',
          message: 'Клиент уже связан с сотрудником',
        },
      });
    }

    const email = customer.email?.trim() || null;

    let personId: string | null = null;
    if (email) {
      const existing = await this.prisma.person.findFirst({
        where: { tenantId, email, deletedAt: null },
        select: { id: true },
      });
      personId = existing?.id ?? null;
    }

    if (!personId) {
      const name = customer.name?.trim() || email || 'Без имени';
      const created = await this.persons.create({
        tenantId,
        userId,
        body: { name, ...(email ? { email } : {}), relationship: 'external' },
      });
      personId = created.id;
    }

    return this.linkCustomer(tenantId, customerId, personId);
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
        linkedPersonId: true,
      },
    });

    const personMap = await this.resolvePersons(
      tenantId,
      customers.map((c) => c.linkedPersonId),
    );

    return customers.map((c) => ({
      id: c.id,
      externalId: c.externalId,
      email: c.email,
      phone: c.phone,
      name: c.name,
      linkMode: c.linkMode,
      linkedPerson: c.linkedPersonId ? (personMap.get(c.linkedPersonId) ?? null) : null,
    }));
  }

  async linkCustomer(
    tenantId: string,
    customerId: string,
    personId: string | null,
  ): Promise<ChatboxCustomerDto> {
    const customer = await this.prisma.chatboxCustomer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
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

    if (personId !== null) {
      const person = await this.prisma.person.findFirst({
        where: { id: personId, tenantId },
        select: { id: true },
      });
      if (!person) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'person_not_found', message: 'Person не найден' },
        });
      }
    }

    const updated = await this.prisma.chatboxCustomer.update({
      where: { id: customerId },
      data:
        personId !== null
          ? { linkedPersonId: personId, linkMode: 'manual' }
          : { linkedPersonId: null, linkMode: 'none' },
      select: {
        id: true,
        externalId: true,
        email: true,
        phone: true,
        name: true,
        linkMode: true,
        linkedPersonId: true,
      },
    });

    const personMap = await this.resolvePersons(tenantId, [updated.linkedPersonId]);

    return {
      id: updated.id,
      externalId: updated.externalId,
      email: updated.email,
      phone: updated.phone,
      name: updated.name,
      linkMode: updated.linkMode,
      linkedPerson: updated.linkedPersonId ? (personMap.get(updated.linkedPersonId) ?? null) : null,
    };
  }

  private async resolvePersons(
    tenantId: string,
    ids: (string | null)[],
  ): Promise<Map<string, ChatboxLinkedPersonDto>> {
    const personIds = [...new Set(ids.filter((id): id is string => !!id))];
    if (personIds.length === 0) {
      return new Map();
    }
    const persons = await this.prisma.person.findMany({
      where: { tenantId, id: { in: personIds } },
      select: { id: true, name: true },
    });
    return new Map(persons.map((p) => [p.id, { id: p.id, name: p.name }]));
  }
}
