import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ValueRecapService, shiftPeriod } from '../services/value-recap.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — ValueRecapCron.
 *
 * `@Cron('0 7 1 * *')` — 1-е число месяца, 07:00 UTC (= 10:00 МСК). Обходит
 * активные Org → `build` за ПРОШЛЫЙ месяц → push-first владельцу/COO
 * (Telegram/email через бюджет Ф0, eventType `operations.monthly_recap`). Экран
 * (drill-down) — отдельный эндпоинт.
 *
 * Master-flag `operations.value_recap.enabled` (kill-switch, ON по умолчанию).
 * False → cron тикает, но сразу выходит (без рестарта).
 *
 * Идемпотентность:
 *   - снимок upsert'ится по (tenantId, periodYm);
 *   - push шлём только если `deliveredAt IS NULL` (повторный прогон не задвоит).
 *
 * Метрики: `value_recap_built_total` (в сервисе),
 * `value_recap_delivered_total{channel}`.
 */
@Injectable()
export class ValueRecapCron {
  private readonly logger = new Logger(ValueRecapCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ValueRecapService) private readonly recap: ValueRecapService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 7 1 * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.value_recap.enabled',
      'OPERATIONS_VALUE_RECAP_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'value-recap.cron: operations.value_recap.enabled=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.log(stats, 'value-recap.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'value-recap.cron: непойманная ошибка',
      );
    }
  }

  /** Выделен для unit-тестов: можно передать произвольный `now`. */
  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    recapsBuilt: number;
    delivered: number;
    errors: number;
  }> {
    // Отчёт за ПРОШЛЫЙ месяц (cron запускается 1-го числа нового месяца).
    const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const periodYm = shiftPeriod(currentPeriod, -1);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let recapsBuilt = 0;
    let delivered = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      let built: Awaited<ReturnType<ValueRecapService['build']>>;
      try {
        built = await this.recap.build({
          tenantId: org.id,
          periodYm,
          now,
        });
        recapsBuilt++;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            periodYm,
            err: err instanceof Error ? err.message : String(err),
          },
          'value-recap.cron: build упал для Org',
        );
        continue;
      }

      if (built.alreadyDelivered) continue; // push идемпотентен по deliveredAt

      try {
        const sent = await this.notifyOwners({
          tenantId: org.id,
          snapshotId: built.id,
          periodYm,
          narrative: built.payload.narrative,
          tenantTop,
        });
        if (sent > 0) {
          await this.recap.markDelivered(built.id);
          delivered += sent;
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            snapshotId: built.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'value-recap.cron: push владельцам упал',
        );
      }
    }

    return { orgsProcessed: orgs.length, recapsBuilt, delivered, errors };
  }

  /**
   * Push владельцу/COO Org'а (БЕЗ admin — IT/devops-роль). Через дневной
   * бюджет Ф0, eventType `operations.monthly_recap`. Возвращает кол-во
   * отправленных.
   */
  private async notifyOwners(args: {
    tenantId: string;
    snapshotId: string;
    periodYm: string;
    narrative: string;
    tenantTop: string;
  }): Promise<number> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: args.tenantId, role: { in: ['owner', 'coo'] } },
      select: { userId: true },
    });
    if (memberships.length === 0) return 0;

    const title = `Итоги месяца ${args.periodYm}: что сделала Кора`;
    const body =
      (args.narrative || 'Готова месячная сводка. Откройте «Итоги месяца» в панели операций.')
        .slice(0, 3_900);
    const actionUrl = `/dashboard/operations/value-recap?period=${args.periodYm}`;

    let sent = 0;
    for (const m of memberships) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'operations.monthly_recap',
          payload: {
            snapshotId: args.snapshotId,
            periodYm: args.periodYm,
            title,
            body,
            actionUrl,
          },
          dataClass: 'internal',
        });
        sent++;
        this.metrics.incValueRecapDelivered({ channel: 'conversational' });
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'value-recap.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }
}
