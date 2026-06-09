import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { PersonsService } from '../persons/services/persons.service';

import type {
  ChatboxLinkedPersonDto,
  ChatboxMemberDto,
} from './dto/chatbox-members.dto';

/**
 * ChatboxMembersService — список членов ChatBox с резолвом связанной Person и
 * ручной маппинг член → Person Коры (ТЗ 2026-06-05, Фаза 9).
 *
 * Автосвязка по email живёт в ChatboxSyncService.syncMembers; здесь — только
 * чтение и ручное управление связкой (linkMode='manual'|'none').
 */
@Injectable()
export class ChatboxMembersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

  /**
   * Создать сотрудника (Person) на основе члена ChatBox и привязать к нему.
   * Дедуп: если в org уже есть Person с таким email — связываем существующего
   * (нового не плодим). Иначе создаём «голую» карточку (name + email, без
   * отдела/роли — заполняется потом в «Сотрудниках») и связываем.
   * linkMode становится 'manual'.
   */
  async createPersonAndLink(
    tenantId: string,
    userId: string,
    memberId: string,
  ): Promise<ChatboxMemberDto> {
    const member = await this.prisma.chatboxMember.findFirst({
      where: { id: memberId, tenantId },
      select: { id: true, name: true, email: true, linkedPersonId: true },
    });
    if (!member) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_member_not_found',
          message: 'Член ChatBox не найден',
        },
      });
    }
    if (member.linkedPersonId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_member_already_linked',
          message: 'Член уже связан с сотрудником',
        },
      });
    }

    const email = member.email?.trim() || null;

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
      const name = member.name?.trim() || email || 'Без имени';
      const created = await this.persons.create({
        tenantId,
        userId,
        body: { name, ...(email ? { email } : {}) },
      });
      personId = created.id;
    }

    // Переиспользуем linkMember — он ставит linkedPersonId + linkMode='manual'.
    return this.linkMember(tenantId, memberId, personId);
  }

  /** Список членов org с резолвом связанной Person (батч, без N+1). */
  async listMembers(tenantId: string): Promise<ChatboxMemberDto[]> {
    const members = await this.prisma.chatboxMember.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        externalId: true,
        email: true,
        name: true,
        role: true,
        linkMode: true,
        linkedPersonId: true,
      },
    });

    const personMap = await this.resolvePersons(
      tenantId,
      members.map((m) => m.linkedPersonId),
    );

    return members.map((m) => ({
      id: m.id,
      externalId: m.externalId,
      email: m.email,
      name: m.name,
      role: m.role,
      linkMode: m.linkMode,
      linkedPerson: m.linkedPersonId
        ? (personMap.get(m.linkedPersonId) ?? null)
        : null,
    }));
  }

  /**
   * Ручная привязка члена к Person (`personId`) или снятие связи (`null`).
   *   - personId задан → linkMode='manual', linkedPersonId=personId.
   *   - personId=null  → linkMode='none', linkedPersonId=null.
   */
  async linkMember(
    tenantId: string,
    memberId: string,
    personId: string | null,
  ): Promise<ChatboxMemberDto> {
    const member = await this.prisma.chatboxMember.findFirst({
      where: { id: memberId, tenantId },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_member_not_found',
          message: 'Член ChatBox не найден',
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

    const updated = await this.prisma.chatboxMember.update({
      where: { id: memberId },
      data:
        personId !== null
          ? { linkedPersonId: personId, linkMode: 'manual' }
          : { linkedPersonId: null, linkMode: 'none' },
      select: {
        id: true,
        externalId: true,
        email: true,
        name: true,
        role: true,
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
      name: updated.name,
      role: updated.role,
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
