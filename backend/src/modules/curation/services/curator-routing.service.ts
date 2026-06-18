import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CurationLevel, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class CuratorRoutingService {
  private readonly logger = new Logger(CuratorRoutingService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveCurators(args: {
    tenantId: string;
    resourceType: string;
    level?: CurationLevel;
    criteria?: Record<string, unknown>;
  }): Promise<string[]> {
    const { tenantId, resourceType, level, criteria } = args;

    const exact = await this.findAssignments({
      tenantId,
      resourceType,
      levelExact: level ?? null,
    });
    const exactMatched = exact.filter((a) => this.matchesCriteria(a.criteria, criteria));
    if (exactMatched.length > 0) {
      return uniq(exactMatched.flatMap((a) => a.curatorUserIds));
    }

    if (level !== undefined) {
      const universal = await this.findAssignments({
        tenantId,
        resourceType,
        levelExact: null,
      });
      const universalMatched = universal.filter((a) => this.matchesCriteria(a.criteria, criteria));
      if (universalMatched.length > 0) {
        return uniq(universalMatched.flatMap((a) => a.curatorUserIds));
      }
    }

    const wildcard = await this.findAssignments({
      tenantId,
      resourceType: '*',
      levelExact: 'any',
    });
    const wildcardMatched = wildcard.filter((a) => this.matchesCriteria(a.criteria, criteria));
    if (wildcardMatched.length > 0) {
      return uniq(wildcardMatched.flatMap((a) => a.curatorUserIds));
    }

    return this.fallbackOwnersAdmins(tenantId);
  }

  private async findAssignments(args: {
    tenantId: string;
    resourceType: string;
    levelExact: CurationLevel | null | 'any';
  }): Promise<
    Array<{
      curatorUserIds: string[];
      criteria: Prisma.JsonValue | null;
    }>
  > {
    const where: Prisma.CuratorAssignmentWhereInput = {
      tenantId: args.tenantId,
      resourceType: args.resourceType,
    };
    if (args.levelExact === null) {
      where.level = null;
    } else if (args.levelExact !== 'any') {
      where.level = args.levelExact;
    }
    return this.prisma.curatorAssignment.findMany({
      where,
      select: { curatorUserIds: true, criteria: true },
    });
  }

  private async fallbackOwnersAdmins(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    });
    const ids = memberships.map((m) => m.userId);
    if (ids.length === 0) {
      this.logger.warn(
        { tenantId },
        'curator-routing: ни ассайнментов, ни owner/admin для Org — кандидатов 0',
      );
    }
    return uniq(ids);
  }

  private matchesCriteria(
    assignmentCriteria: Prisma.JsonValue | null,
    inputCriteria: Record<string, unknown> | undefined,
  ): boolean {
    if (!assignmentCriteria) return true;
    if (typeof assignmentCriteria !== 'object' || Array.isArray(assignmentCriteria)) {
      return true;
    }
    if (!inputCriteria) return false;
    const obj = assignmentCriteria as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (v === '*') continue;
      if (inputCriteria[k] !== v) return false;
    }
    return true;
  }
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter((s) => typeof s === 'string' && s.length > 0)));
}
