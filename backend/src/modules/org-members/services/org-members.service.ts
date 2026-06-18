import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  OrgMemberPersonItemDto,
  OrgMemberSearchItemDto,
  OrgMemberUserItemDto,
  OrgMembersSearchResponseDto,
} from '../dto/org-members.dto';

@Injectable()
export class OrgMembersService {
  private readonly logger = new Logger(OrgMembersService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(args: {
    tenantId: string;
    q: string;
    limit: number;
  }): Promise<OrgMembersSearchResponseDto> {
    const q = args.q.trim();
    if (!q) return { items: [] };
    const limit = args.limit;

    const expand = Math.min(limit * 3, 60);

    const [users, persons] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          memberships: { some: { orgId: args.tenantId } },
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        },
        select: { id: true, name: true, email: true },
        orderBy: [{ name: 'asc' }],
        take: expand,
      }),
      this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          userId: true,
          relationship: true,
          primaryDepartment: { select: { name: true } },
        },
        orderBy: [{ name: 'asc' }],
        take: expand,
      }),
    ]);

    const userItems: OrgMemberUserItemDto[] = users.map((u) => ({
      type: 'user',
      userId: u.id,
      name: u.name,
      email: u.email,
      primaryRole: null,
      avatarUrl: null,
    }));

    const userIds = new Set(users.map((u) => u.id));

    const personItems: OrgMemberPersonItemDto[] = persons
      .filter((p) => !(p.userId && userIds.has(p.userId)))
      .map((p) => ({
        type: 'person',
        personId: p.id,
        name: p.name,
        email: p.email ? p.email : null,
        relationship: p.relationship,
        primaryDepartment: p.primaryDepartment?.name ?? null,
      }));

    const combined: OrgMemberSearchItemDto[] = [...userItems, ...personItems];

    const qLower = q.toLowerCase();
    combined.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aStarts = an.startsWith(qLower) ? 0 : 1;
      const bStarts = bn.startsWith(qLower) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      const aType = a.type === 'user' ? 0 : 1;
      const bType = b.type === 'user' ? 0 : 1;
      if (aType !== bType) return aType - bType;
      return an.localeCompare(bn, 'ru');
    });

    return { items: combined.slice(0, limit) };
  }
}
