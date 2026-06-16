import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';

import {
  CAPABILITIES,
  type Capability,
  type CapabilityOverrideItem,
  type UpsertCapabilityDto,
} from './dto/capability-override.dto';

@Injectable()
export class CapabilitiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  private async assertManager(actorUserId: string, orgId: string): Promise<void> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Управлять доступами может только владелец или администратор',
        },
      });
    }
  }

  private assertCapability(cap: string): void {
    if (!(CAPABILITIES as readonly string[]).includes(cap)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'unknown_capability', message: 'Неизвестная возможность' },
      });
    }
  }

  private async assertMember(orgId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'member_not_found',
          message: 'Участник не найден в этой компании',
        },
      });
    }
  }

  async listForMember(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<CapabilityOverrideItem[]> {
    await this.assertManager(actorUserId, orgId);
    await this.assertMember(orgId, targetUserId);

    const now = new Date();
    const rows = await this.prisma.employeeCapabilityOverride.findMany({
      where: {
        tenantId: orgId,
        grantedToUserId: targetUserId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { capability: true, effect: true, expiresAt: true },
    });

    const byCapability = new Map(rows.map((r) => [r.capability, r]));

    return CAPABILITIES.map((capability): CapabilityOverrideItem => {
      const row = byCapability.get(capability);
      return {
        capability,
        effect: row ? (row.effect as 'allow' | 'deny') : null,
        expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
      };
    });
  }

  async upsert(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    capability: string,
    body: UpsertCapabilityDto,
  ): Promise<CapabilityOverrideItem> {
    await this.assertManager(actorUserId, orgId);
    this.assertCapability(capability);
    await this.assertMember(orgId, targetUserId);

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    const row = await this.prisma.employeeCapabilityOverride.upsert({
      where: {
        tenantId_grantedToUserId_capability: {
          tenantId: orgId,
          grantedToUserId: targetUserId,
          capability,
        },
      },
      create: {
        tenantId: orgId,
        grantedToUserId: targetUserId,
        capability,
        effect: body.effect,
        expiresAt,
        grantedById: actorUserId,
      },
      update: {
        effect: body.effect,
        expiresAt,
        grantedById: actorUserId,
        revokedAt: null,
        revokedBy: null,
      },
      select: { capability: true, effect: true, expiresAt: true },
    });

    return {
      capability: row.capability as Capability,
      effect: row.effect as 'allow' | 'deny',
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
  }

  async remove(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    capability: string,
  ): Promise<{ ok: true }> {
    await this.assertManager(actorUserId, orgId);
    this.assertCapability(capability);

    await this.prisma.employeeCapabilityOverride.deleteMany({
      where: {
        tenantId: orgId,
        grantedToUserId: targetUserId,
        capability,
      },
    });

    return { ok: true };
  }

  async getEffectiveOverrides(
    userId: string,
    tenantId: string,
  ): Promise<Record<string, 'allow' | 'deny'>> {
    const now = new Date();
    const rows = await this.prisma.employeeCapabilityOverride.findMany({
      where: {
        tenantId,
        grantedToUserId: userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { capability: true, effect: true },
    });

    const allowed = new Set<string>(CAPABILITIES as readonly string[]);
    const result: Record<string, 'allow' | 'deny'> = {};
    for (const row of rows) {
      if (allowed.has(row.capability)) {
        result[row.capability] = row.effect as 'allow' | 'deny';
      }
    }
    return result;
  }
}
