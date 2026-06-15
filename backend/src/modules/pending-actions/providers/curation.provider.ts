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

/**
 * Провайдер «требует проверки» из Слоя 4 (CurationItem, status=pending).
 *
 * Кому показываем:
 *   - кандидату-куратору (user ∈ candidateCuratorIds) либо назначенному
 *     (assignedToUserId = user);
 *   - owner/admin Org — все pending-items (privileged).
 *
 * severity=urgent, если карточка просрочена (expiresAt < now), скоро истечёт
 * (expiresAt < now + cfg.pendingActions.reminderLeadDays) или висит
 * ≥ cfg.pendingActions.urgentAgeDays дней. Оба порога — admin-editable.
 * canQuickConfirm = (level === 'light').
 */
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
        proposedPayload: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    const now = new Date();
    const leadWindowMs =
      this.cfg.pendingActions.reminderLeadDays * 24 * 60 * 60 * 1000;
    return items.map((i) => {
      const ageDays = ageDaysFrom(i.createdAt, now);
      // overdue (просрочена) ИЛИ скоро истечёт (в пределах reminderLeadDays).
      const expiringSoon =
        i.expiresAt != null &&
        i.expiresAt.getTime() < now.getTime() + leadWindowMs;
      // proposedPayload — что специалист предлагает зафиксировать (поля
      // зависят от типа карточки: name / title / statement / text).
      const payload = asObject(i.proposedPayload);
      const cardTitle =
        strOrUndef(payload.name) ??
        strOrUndef(payload.title) ??
        strOrUndef(payload.statement) ??
        strOrUndef(payload.text) ??
        resourceTypeRu(i.resourceType);
      const preview =
        strOrUndef(payload.statement) ?? strOrUndef(payload.text);
      const detail: CurationPendingDetail = {
        kind: 'curation',
        cardTitle,
        // preview не дублируем, если он совпадает с заголовком.
        preview: preview && preview !== cardTitle ? preview : undefined,
      };
      // resourceId = CurationItem.id — стабильный ключ для snooze/confirm.
      // Ведём прямо на detail-карточку /curation/[id]; light-карточки
      // по-прежнему подтверждаются one-tap прямо на /actions без перехода.
      return {
        source: this.source,
        resourceType: i.resourceType,
        resourceId: i.id,
        // Реальная суть: название карточки + тип ресурса.
        title: `Требует проверки: ${cardTitle}`,
        severity:
          expiringSoon || ageDays >= this.cfg.pendingActions.urgentAgeDays
            ? 'urgent'
            : 'normal',
        ageDays,
        actionUrl: `/curation/${i.id}`,
        canQuickConfirm: i.level === 'light',
        detail,
      } satisfies PendingActionItem;
    });
  }
}

/** Безопасно приводит Prisma.JsonValue к объекту (иначе пустой объект). */
function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** Непустая строка или undefined (тримит). */
function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
