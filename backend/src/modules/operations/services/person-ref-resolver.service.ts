import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export type PersonRefSource =
  | 'checkin'
  | 'assistant'
  | 'chat'
  | 'free_note'
  | 'bitrix'
  | 'chatbox';

export interface PersonRefInput {
  personId?: string | null;
  userId?: string | null;
  externalId?: string | null;
  source: PersonRefSource;
  isClient?: boolean;
}

export interface PersonRef {
  personId: string | null;
  isClient: boolean;
  personName: string | null;
}

interface PersonRefMaps {
  nameById: Map<string, string>;
  byUserId: Map<string, string>;
  bitrixExtToPerson: Map<string, string>;
  chatboxExtToPerson: Map<string, string>;
}

@Injectable()
export class PersonRefResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(tenantId: string): Promise<PersonRefResolver> {
    const [persons, bitrixUsers, chatboxMembers] = await Promise.all([
      this.prisma.person.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, userId: true },
      }),
      this.prisma.bitrixUser.findMany({
        where: { tenantId, linkedPersonId: { not: null } },
        select: { externalId: true, linkedPersonId: true },
      }),
      this.prisma.chatboxMember.findMany({
        where: { tenantId, linkedPersonId: { not: null } },
        select: { externalId: true, linkedPersonId: true },
      }),
    ]);

    const nameById = new Map<string, string>();
    const byUserId = new Map<string, string>();
    for (const p of persons) {
      nameById.set(p.id, p.name);
      if (p.userId) byUserId.set(p.userId, p.id);
    }

    const bitrixExtToPerson = new Map<string, string>();
    for (const b of bitrixUsers) {
      if (b.linkedPersonId) bitrixExtToPerson.set(b.externalId, b.linkedPersonId);
    }

    const chatboxExtToPerson = new Map<string, string>();
    for (const c of chatboxMembers) {
      if (c.linkedPersonId) chatboxExtToPerson.set(c.externalId, c.linkedPersonId);
    }

    return new PersonRefResolver({
      nameById,
      byUserId,
      bitrixExtToPerson,
      chatboxExtToPerson,
    });
  }
}

export class PersonRefResolver {
  constructor(private readonly maps: PersonRefMaps) {}

  resolve(input: PersonRefInput): PersonRef {
    if (input.isClient === true) {
      return { personId: null, isClient: true, personName: null };
    }

    if (input.personId) {
      return {
        personId: input.personId,
        isClient: false,
        personName: this.maps.nameById.get(input.personId) ?? null,
      };
    }

    if (input.userId) {
      const personId = this.maps.byUserId.get(input.userId) ?? null;
      return {
        personId,
        isClient: false,
        personName: personId ? (this.maps.nameById.get(personId) ?? null) : null,
      };
    }

    if (input.source === 'bitrix' && input.externalId) {
      const personId = this.maps.bitrixExtToPerson.get(input.externalId) ?? null;
      return {
        personId,
        isClient: false,
        personName: personId ? (this.maps.nameById.get(personId) ?? null) : null,
      };
    }

    if (input.source === 'chatbox' && input.externalId) {
      const personId = this.maps.chatboxExtToPerson.get(input.externalId) ?? null;
      return {
        personId,
        isClient: false,
        personName: personId ? (this.maps.nameById.get(personId) ?? null) : null,
      };
    }

    return { personId: null, isClient: false, personName: null };
  }
}
