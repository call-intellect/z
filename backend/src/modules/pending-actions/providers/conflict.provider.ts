import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ageDaysFrom,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

/**
 * Провайдер «открытый конфликт карточек» (ConflictItem, status=open).
 *
 * Кому показываем: только owner/admin Org (резолюция конфликта — их
 * прерогатива). Член без привилегий видит 0.
 *
 * severity=urgent, если конфликт висит ≥ 5 дней. canQuickConfirm=false
 * (резолюция требует выбора стратегии — не «один клик»).
 */
@Injectable()
export class ConflictPendingProvider implements PendingActionsProvider {
  readonly source = 'conflict' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private buildWhere(
    a: PendingActionsProviderArgs,
  ): Prisma.ConflictItemWhereInput {
    const where: Prisma.ConflictItemWhereInput = {
      tenantId: a.tenantId,
      status: 'open',
    };
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    if (!isPrivileged(a.role)) return 0;
    return this.prisma.conflictItem.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    if (!isPrivileged(a.role)) return [];
    const items = await this.prisma.conflictItem.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: { id: true, resourceType: true, createdAt: true },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      return {
        source: this.source,
        resourceType: i.resourceType,
        resourceId: i.id,
        title: `Конфликт карточек: ${i.resourceType}`,
        severity: ageDays >= 5 ? 'urgent' : 'normal',
        ageDays,
        actionUrl: `/curation/conflicts/${i.id}`,
        canQuickConfirm: false,
      } satisfies PendingActionItem;
    });
  }
}
