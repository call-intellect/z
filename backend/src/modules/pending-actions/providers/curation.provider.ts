import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resourceTypeRu } from '../resource-type-ru';

import {
  ageDaysFrom,
  type CurationPendingDetail,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

@Injectable()
export class CurationPendingProvider implements PendingActionsProvider {
  readonly source = 'curation' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.CurationItemWhereInput {
    const where: Prisma.CurationItemWhereInput = {
      tenantId: a.tenantId,
      status: 'pending',
    };
    if (!isPrivileged(a.role)) {
      where.OR = [{ assignedToUserId: a.userId }, { candidateCuratorIds: { has: a.userId } }];
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
        proposedPayload: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    const leadWindowMs = this.cfg.pendingActions.reminderLeadDays * 24 * 60 * 60 * 1000;
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const expiringSoon =
        i.expiresAt != null && i.expiresAt.getTime() < now.getTime() + leadWindowMs;
      const payload = asObject(i.proposedPayload);
      const cardTitle =
        strOrUndef(payload.personName) ??
        strOrUndef(payload.name) ??
        strOrUndef(payload.title) ??
        strOrUndef(payload.statement) ??
        strOrUndef(payload.text) ??
        resourceTypeRu(i.resourceType);
      const preview = strOrUndef(payload.statement) ?? strOrUndef(payload.text);
      const detail: CurationPendingDetail = {
        kind: 'curation',
        cardTitle,
        preview: preview && preview !== cardTitle ? preview : undefined,
      };
      return {
        source: this.source,
        resourceType: i.resourceType,
        resourceId: i.id,
        title: `Требует проверки: ${cardTitle}`,
        severity:
          expiringSoon || ageDays >= this.cfg.pendingActions.urgentAgeDays ? 'urgent' : 'normal',
        ageDays,
        actionUrl: `/curation/${i.id}`,
        canQuickConfirm: i.level === 'light',
        detail,
      } satisfies PendingActionItem;
    });
  }
}

function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
