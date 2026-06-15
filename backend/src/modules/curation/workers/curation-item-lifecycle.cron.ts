import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';

/**
 * CurationItemLifecycleCron (Action Center B5 — «оживление expiresAt»).
 *
 * Раз в сутки переводит просроченные pending-CurationItem'ы в статус `expired`,
 * чтобы очередь проверки не копилась вечно. До B5 поле `expiresAt` было мёртвым:
 * ни один крон не закрывал items, severity вычислялась только на чтении.
 *
 * Алгоритм (per-Org, best-effort):
 *   1. Находим pending-items с `expiresAt < now`.
 *   2. `updateMany status='expired'` (батч).
 *   3. Метрики: `curation_item_expired_total{resource_type}` на каждый item +
 *      `curation_item_age_seconds{level}` (createdAt → expiresAt).
 *   4. Если просроченных >0 — уведомляем owner/admin Org (best-effort,
 *      `system.message`, severity 'warning'). Дедуп не критичен — крон раз в сутки.
 *
 * Cron-литерал `'0 2 * * *'` (раз в сутки, ночь UTC).
 *
 * Редизайн Ф4 «Требует вас» (2026-06-13) — тот же крон авто-закрывает и
 * другие протухшие источники единой очереди решений (idempotent updateMany):
 *   - ConflictItem `status=open & expiresAt<now` → `dismissed`
 *     (+ reasoning «авто-закрыт по сроку»);
 *   - IntakeIssue `status=pending & expiresAt<now` → `rejected`
 *     (+ rejectedReason «авто-закрыт по сроку»).
 * Так очередь решений не копится вечно ни по одному источнику.
 */
@Injectable()
export class CurationItemLifecycleCron {
  private readonly logger = new Logger(CurationItemLifecycleCron.name);

  /** Причина авто-закрытия по сроку (редизайн Ф4). */
  static readonly AUTO_EXPIRE_REASON = 'авто-закрыт по сроку';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @Cron('0 2 * * *')
  async runLifecycle(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(summary, 'curation-item-lifecycle: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'curation-item-lifecycle: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    expiredTotal: number;
    notificationsSent: number;
    conflictsDismissed: number;
    intakesRejected: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let expiredTotal = 0;
    let notificationsSent = 0;
    let conflictsDismissed = 0;
    let intakesRejected = 0;

    for (const org of orgs) {
      try {
        const sent = await this.runForOrg(org.id);
        expiredTotal += sent.expired;
        notificationsSent += sent.notified;
        conflictsDismissed += sent.conflictsDismissed;
        intakesRejected += sent.intakesRejected;
      } catch (err) {
        // best-effort: ошибка одной Org не должна валить весь проход.
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'curation-item-lifecycle: ошибка обработки Org — пропускаю',
        );
      }
    }

    return {
      scannedOrgs: orgs.length,
      expiredTotal,
      notificationsSent,
      conflictsDismissed,
      intakesRejected,
    };
  }

  private async runForOrg(tenantId: string): Promise<{
    expired: number;
    notified: number;
    conflictsDismissed: number;
    intakesRejected: number;
  }> {
    const now = new Date();

    // 0. Редизайн Ф4 — авто-закрытие протухших конфликтов/intake (idempotent
    //    updateMany по фильтру status+expiresAt). Выполняется ВСЕГДА, даже
    //    если протухших curation-items нет.
    const { conflictsDismissed, intakesRejected } =
      await this.sweepConflictAndIntake(tenantId, now);

    // 1. Собираем просроченные pending-items (нужны поля для метрик).
    const candidates = await this.prisma.curationItem.findMany({
      where: {
        tenantId,
        status: 'pending',
        expiresAt: { not: null, lt: now },
      },
      select: {
        id: true,
        resourceType: true,
        level: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (candidates.length === 0) {
      return { expired: 0, notified: 0, conflictsDismissed, intakesRejected };
    }

    // 2. Батчевый перевод pending → expired.
    const ids = candidates.map((c) => c.id);
    await this.prisma.curationItem.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'expired' },
    });

    // 3. Метрики по каждому просроченному item.
    for (const c of candidates) {
      this.metrics.incCurationItemExpired({ resourceType: c.resourceType });
      this.metrics.incCurationItem({
        resourceType: c.resourceType,
        level: c.level,
        status: 'expired',
      });
      if (c.expiresAt) {
        const ageSeconds = Math.max(
          0,
          Math.floor((c.expiresAt.getTime() - c.createdAt.getTime()) / 1000),
        );
        this.metrics.observeCurationItemAge({
          level: c.level,
          seconds: ageSeconds,
        });
      }
    }

    // 4. Уведомление owner/admin Org (best-effort).
    let notified = 0;
    try {
      notified = await this.notifyOwners(tenantId, candidates.length);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'curation-item-lifecycle: ошибка уведомления owner/admin — пропускаю',
      );
    }

    return {
      expired: candidates.length,
      notified,
      conflictsDismissed,
      intakesRejected,
    };
  }

  /**
   * Редизайн Ф4 «Требует вас» (2026-06-13) — авто-закрытие протухших
   * источников единой очереди решений. Идемпотентно: `updateMany` по фильтру
   * `status + expiresAt<now` — повторный прогон не находит уже закрытых.
   *   - ConflictItem open → dismissed (reasoning «авто-закрыт по сроку»);
   *   - IntakeIssue pending → rejected (rejectedReason «авто-закрыт по сроку»).
   */
  private async sweepConflictAndIntake(
    tenantId: string,
    now: Date,
  ): Promise<{ conflictsDismissed: number; intakesRejected: number }> {
    const reason = CurationItemLifecycleCron.AUTO_EXPIRE_REASON;

    const [conflicts, intakes] = await Promise.all([
      this.prisma.conflictItem.updateMany({
        where: {
          tenantId,
          status: 'open',
          expiresAt: { not: null, lt: now },
        },
        data: {
          status: 'dismissed',
          reasoning: reason,
          resolvedAt: now,
        },
      }),
      this.prisma.intakeIssue.updateMany({
        where: {
          tenantId,
          status: 'pending',
          expiresAt: { not: null, lt: now },
        },
        data: {
          status: 'rejected',
          rejectedReason: reason,
          triagedAt: now,
        },
      }),
    ]);

    if (conflicts.count > 0 || intakes.count > 0) {
      this.logger.log(
        {
          tenantId,
          conflictsDismissed: conflicts.count,
          intakesRejected: intakes.count,
        },
        'curation-item-lifecycle: авто-закрыты протухшие конфликты/intake',
      );
    }

    return {
      conflictsDismissed: conflicts.count,
      intakesRejected: intakes.count,
    };
  }

  /**
   * Уведомляет owner/admin Org о просроченных карточках. Best-effort:
   * ошибка одного получателя не валит остальных.
   */
  private async notifyOwners(
    tenantId: string,
    expiredCount: number,
  ): Promise<number> {
    const owners = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
      take: 10,
    });
    if (owners.length === 0) return 0;

    let sent = 0;
    for (const o of owners) {
      try {
        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: o.userId,
          eventType: 'system.message',
          payload: {
            title: 'Карточки проверки просрочены',
            body: `${expiredCount} карточек проверки просрочены и закрыты без решения.`,
            severity: 'warning',
            actionUrl: '/curation',
          },
          dataClass: 'internal',
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            recipientUserId: o.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'curation-item-lifecycle: ошибка отправки уведомления — пропускаю',
        );
      }
    }
    return sent;
  }
}
