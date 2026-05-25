import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Admin-redesign Фаза 4 — `AdminPlansService`.
 *
 * CRUD планов продукта (модель `Plan` в schema.prisma уже существует).
 *
 *   - list(): все Plan + counts использования по `OrgEntitlement.tier`.
 *   - create(): новый Plan. Падает 400, если id занят.
 *   - update(): partial update. Поддерживает `isActive` для soft-delete/restore.
 *   - softDelete(): isActive=false. Не блокируется наличием Org с этим tier.
 *   - hardDelete(): полное удаление. Падает 400, если есть Org с tier === id.
 *   - getUsage(): список Org с этим планом + их экономика (последние 10).
 *
 * Все mutating-методы пишутся в `SuperAdminAccessLog` через
 * `SuperAdminAuditInterceptor` (он на контроллере). Никакой собственной
 * audit-логики тут нет.
 */

export interface PlanItem {
  id: string;
  displayName: string;
  description: string | null;
  features: unknown;
  quotas: unknown;
  monthlyPriceRub: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  /** Сколько Org сейчас используют этот тариф (через OrgEntitlement.tier). */
  orgsCount: number;
}

export interface PlanUsageItem {
  tenantId: string;
  orgName: string;
  orgSlug: string;
  membersCount: number;
  meetingsCount: number;
  createdAt: Date;
}

@Injectable()
export class AdminPlansService {
  private readonly logger = new Logger(AdminPlansService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Список всех планов с количеством Org, использующих каждый. Сортировка по
   * `sortOrder` ASC (как в UI выбора тарифа).
   */
  async list(): Promise<{ items: PlanItem[] }> {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    const usage = await this.prisma.orgEntitlement.groupBy({
      by: ['tier'],
      _count: { _all: true },
    });
    const countByTier = new Map<string, number>();
    for (const u of usage) {
      countByTier.set(u.tier, u._count._all);
    }

    const items: PlanItem[] = plans.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      features: p.features,
      quotas: p.quotas,
      monthlyPriceRub: p.monthlyPriceRub,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      orgsCount: countByTier.get(p.id) ?? 0,
    }));
    return { items };
  }

  async create(input: {
    id: string;
    displayName: string;
    description?: string;
    features: Record<string, unknown>;
    quotas: Record<string, unknown>;
    monthlyPriceRub?: number;
    sortOrder?: number;
  }): Promise<PlanItem> {
    const exists = await this.prisma.plan.findUnique({ where: { id: input.id } });
    if (exists) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'plan_id_taken', message: `Plan id "${input.id}" уже существует` },
      });
    }
    const created = await this.prisma.plan.create({
      data: {
        id: input.id,
        displayName: input.displayName,
        ...(input.description !== undefined ? { description: input.description } : {}),
        features: input.features as Prisma.InputJsonValue,
        quotas: input.quotas as Prisma.InputJsonValue,
        monthlyPriceRub: input.monthlyPriceRub ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    this.logger.log(`AdminPlansService: создан Plan id=${created.id}`);
    return {
      id: created.id,
      displayName: created.displayName,
      description: created.description,
      features: created.features,
      quotas: created.quotas,
      monthlyPriceRub: created.monthlyPriceRub,
      isActive: created.isActive,
      sortOrder: created.sortOrder,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      orgsCount: 0,
    };
  }

  async update(
    id: string,
    input: {
      displayName?: string;
      description?: string | null;
      features?: Record<string, unknown>;
      quotas?: Record<string, unknown>;
      monthlyPriceRub?: number | null;
      sortOrder?: number;
      isActive?: boolean;
    },
  ): Promise<PlanItem> {
    const exists = await this.prisma.plan.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'plan_not_found', message: `Plan id="${id}" не найден` },
      });
    }
    const data: Prisma.PlanUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.description !== undefined) data.description = input.description;
    if (input.features !== undefined)
      data.features = input.features as Prisma.InputJsonValue;
    if (input.quotas !== undefined)
      data.quotas = input.quotas as Prisma.InputJsonValue;
    if (input.monthlyPriceRub !== undefined) data.monthlyPriceRub = input.monthlyPriceRub;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.plan.update({ where: { id }, data });
    const orgsCount = await this.prisma.orgEntitlement.count({ where: { tier: id } });

    return {
      id: updated.id,
      displayName: updated.displayName,
      description: updated.description,
      features: updated.features,
      quotas: updated.quotas,
      monthlyPriceRub: updated.monthlyPriceRub,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      orgsCount,
    };
  }

  /**
   * Soft-delete: `isActive=false`. Org с этим tier продолжат пользоваться им
   * до явного перевода админом — это сигнальный «не предлагать новым».
   */
  async softDelete(id: string): Promise<{ ok: true }> {
    const exists = await this.prisma.plan.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'plan_not_found', message: `Plan id="${id}" не найден` },
      });
    }
    await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
    return { ok: true };
  }

  /**
   * Hard-delete: полное удаление Plan. Защита — 400, если хотя бы одна Org
   * использует этот tier через OrgEntitlement.
   */
  async hardDelete(id: string): Promise<{ ok: true }> {
    const exists = await this.prisma.plan.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'plan_not_found', message: `Plan id="${id}" не найден` },
      });
    }
    const used = await this.prisma.orgEntitlement.count({ where: { tier: id } });
    if (used > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'plan_in_use',
          message: `Plan id="${id}" используют ${used} Org. Сначала переведите их на другой тариф либо используйте DELETE-soft.`,
          meta: { orgsCount: used },
        },
      });
    }
    await this.prisma.plan.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Сколько Org используют этот Plan + первые 10 (для drill-down UI).
   */
  async getUsage(id: string): Promise<{
    plan: { id: string; displayName: string; isActive: boolean };
    orgsCount: number;
    items: PlanUsageItem[];
  }> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'plan_not_found', message: `Plan id="${id}" не найден` },
      });
    }
    const ents = await this.prisma.orgEntitlement.findMany({
      where: { tier: id },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            _count: { select: { memberships: true, meetings: true } },
          },
        },
      },
    });
    const orgsCount = await this.prisma.orgEntitlement.count({ where: { tier: id } });
    const items: PlanUsageItem[] = ents
      .filter((e) => e.org !== null)
      .map((e) => ({
        tenantId: e.org!.id,
        orgName: e.org!.name,
        orgSlug: e.org!.slug,
        membersCount: e.org!._count.memberships,
        meetingsCount: e.org!._count.meetings,
        createdAt: e.org!.createdAt,
      }));

    return {
      plan: { id: plan.id, displayName: plan.displayName, isActive: plan.isActive },
      orgsCount,
      items,
    };
  }
}
