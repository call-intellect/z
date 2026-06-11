import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { PersonsService } from '../persons/services/persons.service';

import type {
  ChatboxCustomerDto,
  ChatboxLinkedPersonDto,
} from './dto/chatbox-customers.dto';

/**
 * ChatboxCustomersService — список клиентов ChatBox (`ChatboxCustomer`) с
 * резолвом связанной Person и ручной маппинг клиент → Person Коры
 * (ТЗ 2026-06-11 chatbox-memory-finishing, Ф1). Клон `ChatboxMembersService`.
 *
 * Выбор сущности: первичный контакт-клиент — `ChatboxCustomer` (унифицированный
 * контакт ChatBox, агрегирующий каналы; `ChatboxChannelClient` — это его
 * per-канальные представления). Связку ведём на унифицированном `ChatboxCustomer`.
 *
 * Автосвязка по email/имени живёт в ChatboxSyncService.autoLinkCustomers; здесь —
 * только чтение и ручное управление связкой (linkMode='manual'|'none').
 */
@Injectable()
export class ChatboxCustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

  /**
   * Создать сотрудника (Person) на основе клиента ChatBox и привязать к нему.
   * Дедуп: если в org уже есть Person с таким email — связываем существующего
   * (нового не плодим). Иначе создаём «голую» карточку (name + email) и
   * связываем. linkMode становится 'manual'.
   */
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

    // Дедуп по email: уже есть живой Person с таким адресом → связываем его.
    let personId: string | null = null;
    if (email) {
      const existing = await this.prisma.person.findFirst({
        where: { tenantId, email, deletedAt: null },
        select: { id: true },
      });
      personId = existing?.id ?? null;
    }

    // Иначе создаём новую карточку через штатный PersonsService.
    if (!personId) {
      const name = customer.name?.trim() || email || 'Без имени';
      const created = await this.persons.create({
        tenantId,
        userId,
        body: { name, ...(email ? { email } : {}) },
      });
      personId = created.id;
    }

    // Переиспользуем linkCustomer — он ставит linkedPersonId + linkMode='manual'.
    return this.linkCustomer(tenantId, customerId, personId);
  }

  /** Список клиентов org с резолвом связанной Person (батч, без N+1). */
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
      linkedPerson: c.linkedPersonId
        ? (personMap.get(c.linkedPersonId) ?? null)
        : null,
    }));
  }

  /**
   * Ручная привязка клиента к Person (`personId`) или снятие связи (`null`).
   *   - personId задан → linkMode='manual', linkedPersonId=personId.
   *   - personId=null  → linkMode='none', linkedPersonId=null.
   */
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

    const personMap = await this.resolvePersons(tenantId, [
      updated.linkedPersonId,
    ]);

    return {
      id: updated.id,
      externalId: updated.externalId,
      email: updated.email,
      phone: updated.phone,
      name: updated.name,
      linkMode: updated.linkMode,
      linkedPerson: updated.linkedPersonId
        ? (personMap.get(updated.linkedPersonId) ?? null)
        : null,
    };
  }

  /** Батч-резолв Person по id-шкам → карта id → {id,name}. */
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
    return new Map(
      persons.map((p) => [p.id, { id: p.id, name: p.name }]),
    );
  }
}
