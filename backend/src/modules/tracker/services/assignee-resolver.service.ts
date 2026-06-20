import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export type AssigneeResolution =
  | { kind: 'resolved'; userId: string; name: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: Array<{ userId: string; name: string }> };

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Injectable()
export class AssigneeResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, rawName: string): Promise<AssigneeResolution> {
    const norm = normalizeName(rawName);
    if (!norm) return { kind: 'not_found' };

    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, user: { deletedAt: null } },
      select: { userId: true },
    });
    const activeUserIds = new Set(memberships.map((m) => m.userId));
    if (activeUserIds.size === 0) return { kind: 'not_found' };

    const persons = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null, userId: { not: null } },
      select: { userId: true, name: true },
    });

    const candidates = persons
      .filter((p) => p.userId !== null && activeUserIds.has(p.userId))
      .map((p) => ({ userId: p.userId as string, name: p.name, norm: normalizeName(p.name) }));

    const dedupe = (
      matched: Array<{ userId: string; name: string; norm: string }>,
    ): Array<{ userId: string; name: string }> => {
      const byUser = new Map<string, { userId: string; name: string }>();
      for (const c of matched) {
        if (!byUser.has(c.userId)) byUser.set(c.userId, { userId: c.userId, name: c.name });
      }
      return [...byUser.values()];
    };

    let matched = dedupe(candidates.filter((c) => c.norm === norm));
    if (matched.length === 0) matched = dedupe(candidates.filter((c) => c.norm.startsWith(norm)));
    if (matched.length === 0) matched = dedupe(candidates.filter((c) => c.norm.includes(norm)));

    if (matched.length === 0) return { kind: 'not_found' };
    const first = matched[0];
    if (matched.length === 1 && first) {
      return { kind: 'resolved', userId: first.userId, name: first.name };
    }
    return { kind: 'ambiguous', candidates: matched.slice(0, 5) };
  }
}
