import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { PersonsService } from '../persons/services/persons.service';

import type { ChatboxLinkedPersonDto, ChatboxMemberDto } from './dto/chatbox-members.dto';

@Injectable()
export class ChatboxMembersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

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

    let personId: string | null = null;
    if (email) {
      const existing = await this.prisma.person.findFirst({
        where: { tenantId, email, deletedAt: null },
        select: { id: true },
      });
      personId = existing?.id ?? null;
    }

    if (!personId) {
      const name = member.name?.trim() || email || 'Без имени';
      const created = await this.persons.create({
        tenantId,
        userId,
        body: { name, ...(email ? { email } : {}) },
      });
      personId = created.id;
    }

    return this.linkMember(tenantId, memberId, personId);
  }

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
      linkedPerson: m.linkedPersonId ? (personMap.get(m.linkedPersonId) ?? null) : null,
    }));
  }

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

    if (personId !== null) {
      await this.prisma.person.updateMany({
        where: { id: personId, tenantId, relationship: 'external', deletedAt: null },
        data: { relationship: 'employee' },
      });
    }

    const personMap = await this.resolvePersons(tenantId, [updated.linkedPersonId]);

    return {
      id: updated.id,
      externalId: updated.externalId,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      linkMode: updated.linkMode,
      linkedPerson: updated.linkedPersonId ? (personMap.get(updated.linkedPersonId) ?? null) : null,
    };
  }

  async autoLinkUnlinked(tenantId: string): Promise<{ created: number; linked: number }> {
    const rows = await this.prisma.chatboxMember.findMany({
      where: { tenantId, linkedPersonId: null },
      select: { id: true, name: true, email: true },
    });
    let created = 0;
    let linked = 0;
    for (const m of rows) {
      const email = m.email?.trim() || null;
      let personId: string | null = null;
      if (email) {
        const existing = await this.prisma.person.findFirst({
          where: { tenantId, email, deletedAt: null },
          select: { id: true },
        });
        personId = existing?.id ?? null;
      }
      if (personId) {
        linked += 1;
      } else {
        const name = m.name?.trim() || email || 'Без имени';
        try {
          const person = await this.prisma.person.create({
            data: { tenantId, name, email: email ?? '', relationship: 'employee' },
            select: { id: true },
          });
          personId = person.id;
          created += 1;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && email) {
            const raced = await this.prisma.person.findFirst({
              where: { tenantId, email, deletedAt: null },
              select: { id: true },
            });
            personId = raced?.id ?? null;
            if (personId) linked += 1;
          }
          if (!personId) continue;
        }
      }
      await this.prisma.chatboxMember.update({
        where: { id: m.id },
        data: { linkedPersonId: personId, linkMode: 'auto' },
      });
      await this.prisma.person.updateMany({
        where: { id: personId, tenantId, relationship: 'external', deletedAt: null },
        data: { relationship: 'employee' },
      });
    }
    return { created, linked };
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
