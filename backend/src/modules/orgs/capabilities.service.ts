import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';

import {
  CAPABILITIES,
  type Capability,
  type CapabilityOverrideItem,
  type UpsertCapabilityDto,
} from './dto/capability-override.dto';

/**
 * ТЗ «Команда + доступы» Фаза 5 — персональные override доступа сотрудника.
 *
 * Override — это ДЕЛЬТА (allow/deny) поверх дефолта роли/тарифа; сам дефолт
 * остаётся в существующем слое (RBAC + entitlements) и здесь не трогается.
 * Управлять может только владелец/администратор Org (или super_admin).
 *
 * Активным считается override с revokedAt=null и (expiresAt=null ИЛИ
 * expiresAt>now). Только небиллинговые оси «что человек видит» (см.
 * CAPABILITIES в dto/capability-override.dto.ts).
 */
@Injectable()
export class CapabilitiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /** Проверка прав: только owner/admin/super_admin Org. */
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

  /** Проверка, что capability входит в канонический список. */
  private assertCapability(cap: string): void {
    if (!(CAPABILITIES as readonly string[]).includes(cap)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'unknown_capability', message: 'Неизвестная возможность' },
      });
    }
  }

  /** Проверка, что целевой пользователь — участник этой Org. */
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

  /**
   * Список override'ов по сотруднику — строка по КАЖДОЙ возможности из
   * CAPABILITIES (effect из активного override либо null).
   */
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

  /**
   * Создать/обновить override по конкретной возможности. Re-grant
   * «воскрешает» строку (revokedAt/revokedBy сбрасываются в null).
   */
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

  /** Полностью удалить override по возможности (hard delete). */
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

  /**
   * Эффективные override'ы текущего пользователя — map capability→effect.
   * Только активные (revokedAt=null, expiresAt null/в будущем) и только
   * для возможностей из канонического списка CAPABILITIES.
   */
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
