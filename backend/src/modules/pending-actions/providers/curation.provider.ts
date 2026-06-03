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
 * Провайдер «требует проверки» из Слоя 4 (CurationItem, status=pending).
 *
 * Кому показываем:
 *   - кандидату-куратору (user ∈ candidateCuratorIds) либо назначенному
 *     (assignedToUserId = user);
 *   - owner/admin Org — все pending-items (privileged).
 *
 * severity=urgent, если карточка просрочена (expiresAt < now) или висит ≥ 5 дней.
 * canQuickConfirm = (level === 'light').
 */
@Injectable()
export class CurationPendingProvider implements PendingActionsProvider {
  readonly source = 'curation' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.CurationItemWhereInput {
    const where: Prisma.CurationItemWhereInput = {
      tenantId: a.tenantId,
      status: 'pending',
    };
    // owner/admin видят все pending; остальные — только где они кандидат/назначены.
    if (!isPrivileged(a.role)) {
      where.OR = [
        { assignedToUserId: a.userId },
        { candidateCuratorIds: { has: a.userId } },
      ];
    }
    if (a.snoozedResourceIds.size > 0) {
      where.id = { notIn: [...a.snoozedResourceIds] };
    }
    return where;
  }

  async countForUser(a: PendingActionsProviderArgs): Promise<number> {
    return this.prisma.curationItem.count({ where: this.buildWhere(a) });
  }

  async listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]> {
    const items = await this.prisma.curationItem.findMany({
      where: this.buildWhere(a),
      orderBy: [{ createdAt: 'asc' }],
      take: a.limit,
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        level: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const overdue = i.expiresAt != null && i.expiresAt.getTime() < now.getTime();
      // resourceId = CurationItem.id — стабильный ключ для snooze и actionUrl
      // (`/curation/{id}` совпадает с deep-link'ом probe-нотификаций).
      return {
        source: this.source,
        resourceType: i.resourceType,
        resourceId: i.id,
        title: `Требует проверки: ${i.resourceType} ${i.resourceId}`,
        severity: overdue || ageDays >= 5 ? 'urgent' : 'normal',
        ageDays,
        actionUrl: `/curation/${i.id}`,
        canQuickConfirm: i.level === 'light',
      } satisfies PendingActionItem;
    });
  }
}
