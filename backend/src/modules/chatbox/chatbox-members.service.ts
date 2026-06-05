import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

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
  ) {}

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
