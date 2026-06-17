import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export type OwnerResolution =
  | { kind: 'resolved'; userId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

export interface OwnerResolveArgs {
  tenantId: string;
  parentOwnerUserId?: string | null;
  roleId?: string | null;
  authorUserId?: string | null;
  candidatePool?: string[];
}

@Injectable()
export class OwnerResolverService {
  private readonly logger = new Logger(OwnerResolverService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(args: OwnerResolveArgs): Promise<OwnerResolution> {
    if (args.parentOwnerUserId) {
      return { kind: 'resolved', userId: args.parentOwnerUserId };
    }

    if (args.roleId) {
      try {
        const holders = await this.roleHolderUserIds(args.tenantId, args.roleId);
        if (holders.length === 1) {
          return { kind: 'resolved', userId: holders[0]! };
        }
        if (holders.length > 1) {
          return { kind: 'ambiguous', candidates: holders };
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            roleId: args.roleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'owner-resolver: ошибка поиска держателей роли — пропускаю ступень',
        );
      }
    }

    if (args.authorUserId) {
      return { kind: 'resolved', userId: args.authorUserId };
    }

    const pool = [...new Set(args.candidatePool ?? [])];
    if (pool.length === 1) {
      return { kind: 'resolved', userId: pool[0]! };
    }
    if (pool.length > 1) {
      return { kind: 'ambiguous', candidates: pool };
    }

    return { kind: 'none' };
  }

  private async roleHolderUserIds(tenantId: string, roleId: string): Promise<string[]> {
    const appointments = await this.prisma.appointment.findMany({
      where: { tenantId, roleId, status: 'active', validTo: null },
      select: {
        person: { select: { userId: true, deletedAt: true } },
      },
      take: 50,
    });
    const fromAppointments = this.collectUserIds(appointments.map((a) => a.person));
    if (fromAppointments.length > 0) return fromAppointments;

    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId, roleId, validTo: null },
      select: {
        person: { select: { userId: true, deletedAt: true } },
      },
      take: 50,
    });
    return this.collectUserIds(personRoles.map((pr) => pr.person));
  }

  private collectUserIds(
    persons: Array<{ userId: string | null; deletedAt?: Date | null }>,
  ): string[] {
    const out = new Set<string>();
    for (const p of persons) {
      if (!p.userId) continue;
      if (p.deletedAt) continue;
      out.add(p.userId);
    }
    return [...out];
  }
}
