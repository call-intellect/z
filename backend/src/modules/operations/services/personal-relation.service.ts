import { Inject, Injectable, Logger } from '@nestjs/common';
import { type EntityLinkType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PersonalRelationDto, PersonalRelationListDto } from '../dto/operations-dashboard.dto';

@Injectable()
export class PersonalRelationService {
  private readonly logger = new Logger(PersonalRelationService.name);

  static readonly PERSONAL_RELATION_TYPES: EntityLinkType[] = [
    'manages',
    'collaborates_with',
    'mentors',
    'conflicted_with',
    'transfers_result_to',
    'escalates_to',
    'reports_to',
  ];

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: {
    tenantId: string;
    personId?: string;
    relationType?: string;
    limit?: number;
  }): Promise<PersonalRelationListDto> {
    const limit = Math.min(args.limit ?? 50, 200);
    const relationFilter: EntityLinkType[] = args.relationType
      ? PersonalRelationService.PERSONAL_RELATION_TYPES.includes(
          args.relationType as EntityLinkType,
        )
        ? [args.relationType as EntityLinkType]
        : PersonalRelationService.PERSONAL_RELATION_TYPES
      : PersonalRelationService.PERSONAL_RELATION_TYPES;

    const where: Prisma.EntityLinkWhereInput = {
      tenantId: args.tenantId,
      relationType: { in: relationFilter },
      status: 'active',
      deletedAt: null,
    };

    if (args.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: args.personId, tenantId: args.tenantId, deletedAt: null },
        select: { entityId: true },
      });
      const entityId = person?.entityId;
      if (!entityId) return { items: [], total: 0 };
      where.OR = [{ fromEntityId: entityId }, { toEntityId: entityId }];
    }

    const links = await this.prisma.entityLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fromEntityId: true,
        toEntityId: true,
        relationType: true,
        confidence: true,
        explanation: true,
        createdAt: true,
        validFrom: true,
      },
    });

    if (links.length === 0) return { items: [], total: 0 };

    const entityIds = new Set<string>();
    for (const l of links) {
      entityIds.add(l.fromEntityId);
      entityIds.add(l.toEntityId);
    }
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        entityId: { in: Array.from(entityIds) },
        deletedAt: null,
      },
      select: { id: true, entityId: true, name: true },
    });
    const byEntity = new Map<string, { id: string; name: string }>();
    for (const p of persons) {
      if (p.entityId) byEntity.set(p.entityId, { id: p.id, name: p.name });
    }

    const items: PersonalRelationDto[] = links.map((l) => {
      const from = byEntity.get(l.fromEntityId);
      const to = byEntity.get(l.toEntityId);
      return {
        id: l.id,
        fromPersonId: from?.id ?? l.fromEntityId,
        fromPersonName: from?.name ?? null,
        toPersonId: to?.id ?? l.toEntityId,
        toPersonName: to?.name ?? null,
        relationType: l.relationType,
        confidence: Number(l.confidence.toString()),
        explanation: l.explanation,
        createdAt: l.createdAt.toISOString(),
        observedAt: l.validFrom.toISOString(),
      };
    });

    return { items, total: items.length };
  }
}
