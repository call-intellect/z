import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resourceTypeRu } from '../resource-type-ru';

import {
  ageDaysFrom,
  type ConflictPendingDetail,
  isPrivileged,
  type PendingActionItem,
  type PendingActionsProvider,
  type PendingActionsProviderArgs,
} from './pending-actions-provider.types';

@Injectable()
export class ConflictPendingProvider implements PendingActionsProvider {
  readonly source = 'conflict' as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private buildWhere(a: PendingActionsProviderArgs): Prisma.ConflictItemWhereInput {
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
      select: {
        id: true,
        resourceType: true,
        evidence: true,
        evolvingMeta: true,
        createdAt: true,
      },
    });
    const now = new Date();
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      const ev = asObject(i.evidence);
      const meta = asObject(i.evolvingMeta);
      const summary =
        strOrUndef(ev.explanation) ??
        strOrUndef(ev.reason) ??
        strOrUndef(ev.supersedeReason) ??
        `Конфликт карточек: ${resourceTypeRu(i.resourceType)}`;
      const oldText = strOrUndef(ev.oldStatement) ?? strOrUndef(ev.existingText) ?? '';
      const newText = strOrUndef(ev.newStatement) ?? strOrUndef(ev.newText) ?? '';
      const detail: ConflictPendingDetail = {
        kind: 'conflict',
        summary,
        oldVersion: {
          text: oldText,
          date: strOrUndef(meta.existingValidUntil),
        },
        newVersion: {
          text: newText,
          date: strOrUndef(meta.newValidFrom),
        },
      };
      return {
        source: this.source,
        resourceType: i.resourceType,
        resourceId: i.id,
        title: summary,
        severity: ageDays >= this.cfg.pendingActions.urgentAgeDays ? 'urgent' : 'normal',
        ageDays,
        actionUrl: `/curation/conflicts/${i.id}`,
        canQuickConfirm: false,
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
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
