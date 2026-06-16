import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { DailyDigestService } from '../services/daily-digest.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8.3 — OperationsDailyDigestCron.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.6.
 *
 * Глобальный cron `@Cron('0 22 * * *')` (= 01:00 МСК ежедневно). НЕ
 * per-Org timezone (ICP — РФ, разница до 6 часов несущественна для
 * утреннего отчёта).
 *
 * Тумблеры (через `TypedConfigService.getDynamic` → AdminSetting + ENV-fallback):
 *   - `operations.daily_digest.enabled` (fallback `COO_DAILY_DIGEST_ENABLED`,
 *     default true) — мастер-флаг.
 *   - `operations.daily_digest.deliver_to_telegram` (fallback
 *     `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`, default false) — рассылка в
 *     Telegram. По умолчанию false, чтобы Telegram не молотил сразу после
 *     раскатки. Включается тумблером без рестарта.
 *
 * Поведение:
 *   1. Проверить тумблер `enabled`. False → log skip, return.
 *   2. Вычислить `dateLocal` = вчера в МСК (по UTC-моменту cron'а).
 *   3. Обход всех активных Org (deletedAt IS NULL). На каждую:
 *      - Идемпотентно `DailyDigestService.getOrGenerate({ tenantId, dateLocal })`.
 *      - Если тумблер `deliver_to_telegram=true`, отправить уведомление
 *        `operations.daily_digest` всем coo/owner Org'а (БЕЗ admin —
 *        admin это IT/devops-роль, не бизнес-stakeholder, см. §3 ТЗ).
 *      - Проставить `deliveredAt` после успешной отправки.
 *   4. Best-effort: ошибка по одной Org не валит остальные.
 *
 * Метрики: `coo_daily_digest_generated_total`, `coo_daily_digest_failed_total{reason}`,
 * `coo_daily_digest_delivered_total{channel}`, `coo_daily_digest_age_seconds`.
 */
@Injectable()
export class OperationsDailyDigestCron {
  private readonly logger = new Logger(OperationsDailyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DailyDigestService)
    private readonly digestService: DailyDigestService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 22 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.daily_digest.enabled',
      'COO_DAILY_DIGEST_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'operations-daily-digest.cron: operations.daily_digest.enabled=false, skip',
      );
      return;
    }

    const deliverToTelegram = await this.cfg.getDynamic<boolean>(
      'operations.daily_digest.deliver_to_telegram',
      'COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM',
      false,
    );

    const now = new Date();
    try {
      const stats = await this.runOnce({ now, deliverToTelegram });
      this.logger.debug(
        stats,
        'operations-daily-digest.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'operations-daily-digest.cron: непойманная ошибка',
      );
    }
  }

  /**
   * Выделен для unit-тестов: можно передать произвольный `now` и явно
   * проконтролировать `deliverToTelegram`.
   */
  async runOnce(args: {
    now: Date;
    deliverToTelegram: boolean;
  }): Promise<{
    orgsProcessed: number;
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    notificationsSent: number;
    errors: number;
  }> {
    // `dateLocal` = вчерашний день в МСК.
    const dateLocal = yesterdayInMoscow(args.now);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);

      // Идемпотентность — проверяем существующий дайджест.
      const existing = await this.digestService.getStored({
        tenantId: org.id,
        dateLocal,
      });

      let digestId: string;
      let shortSummary: string | null;
      let alreadyDelivered: string | null;
      if (existing) {
        digestsSkippedAlreadyExists++;
        digestId = existing.id;
        shortSummary = existing.shortSummary;
        alreadyDelivered = existing.deliveredAt;
      } else {
        try {
          const digest = await this.digestService.getOrGenerate({
            tenantId: org.id,
            dateLocal,
          });
          digestsGenerated++;
          digestId = digest.id;
          shortSummary = digest.shortSummary;
          alreadyDelivered = digest.deliveredAt;
        } catch (err) {
          errors++;
          this.metrics.incCooDailyDigestFailed({
            tenantTop,
            reason: 'exception',
          });
          this.logger.warn(
            {
              tenantId: org.id,
              dateLocal,
              err: err instanceof Error ? err.message : String(err),
            },
            'operations-daily-digest.cron: ошибка генерации',
          );
          continue;
        }
      }

      // Доставка в Telegram (или мульти-канально по policy event-type'а).
      if (args.deliverToTelegram && alreadyDelivered === null) {
        try {
          const sent = await this.notifyRecipients({
            tenantId: org.id,
            digestId,
            dateLocal,
            shortSummary,
            tenantTop,
          });
          notificationsSent += sent;
          if (sent > 0) {
            await this.digestService.markDelivered({
              tenantId: org.id,
              dateLocal,
            });
          }
        } catch (err) {
          errors++;
          this.metrics.incCooDailyDigestFailed({
            tenantTop,
            reason: 'notify_failed',
          });
          this.logger.warn(
            {
              tenantId: org.id,
              dateLocal,
              err: err instanceof Error ? err.message : String(err),
            },
            'operations-daily-digest.cron: ошибка отправки',
          );
        }
      }
    }

    return {
      orgsProcessed: orgs.length,
      digestsGenerated,
      digestsSkippedAlreadyExists,
      notificationsSent,
      errors,
    };
  }

  /**
   * Отправить нотификацию `operations.daily_digest` всем coo/owner Org'а
   * (БЕЗ admin — admin это IT/devops-роль, см. §3 ТЗ). Возвращает кол-во
   * отправленных нотификаций.
   */
  private async notifyRecipients(args: {
    tenantId: string;
    digestId: string;
    dateLocal: string;
    shortSummary: string | null;
    tenantTop: string;
  }): Promise<number> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'coo'] },
      },
      select: { userId: true },
    });
    if (memberships.length === 0) return 0;

    const title = `Ежедневный отчёт операционного директора за ${args.dateLocal}`;
    const body =
      args.shortSummary ??
      'Готов ежедневный отчёт за вчера. Откройте «Ежедневный отчёт» в панели операций.';
    // Telegram-лимит ~4096 симв; усекаем shortSummary до 2000 безопасно.
    let safeBody = body.length > 2000 ? body.slice(0, 1999) + '…' : body;
    // TZ-1 Ф1 — секция «Клиенты под риском» (best-effort, не валит дайджест).
    try {
      const customersLine = await this.digestService.buildCustomersAtRiskLine({
        tenantId: args.tenantId,
      });
      if (customersLine) safeBody = `${safeBody}${customersLine}`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'operations-daily-digest.cron: секция «Клиенты под риском» упала — пропускаю',
      );
    }
    const actionUrl = `/dashboard/operations/daily?date=${args.dateLocal}`;

    let sent = 0;
    for (const m of memberships) {
      try {
        // Action Center B3 — персональный блок «Ждёт подтверждения»
        // (best-effort, не валит доставку дайджеста).
        const pendingLine = await this.digestService.buildPendingActionsLine({
          tenantId: args.tenantId,
          userId: m.userId,
        });
        const bodyWithPending = pendingLine
          ? `${safeBody}${pendingLine}`
          : safeBody;
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'operations.daily_digest',
          payload: {
            digestId: args.digestId,
            dateLocal: args.dateLocal,
            title,
            body: bodyWithPending,
            actionUrl,
          },
          dataClass: 'internal',
        });
        sent++;
        this.metrics.incCooDailyDigestDelivered({
          tenantTop: args.tenantTop,
          channel: 'conversational',
        });
      } catch (err) {
        this.metrics.incCooDailyDigestFailed({
          tenantTop: args.tenantTop,
          reason: 'notify_failed',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-daily-digest.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }
}

/**
 * Вчерашняя дата в МСК (YYYY-MM-DD). Используем Intl с timeZone='Europe/Moscow'
 * и сдвигаем на -1 день в UTC-числовом представлении.
 */
export function yesterdayInMoscow(now: Date): string {
  // Получаем компоненты даты в МСК.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayMsk = fmt.format(now); // YYYY-MM-DD
  // Сдвиг на -1 день — через UTC-арифметику над компонентами строки.
  const d = new Date(`${todayMsk}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
