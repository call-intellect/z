import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { DailyCheckInService } from '../services/daily-checkin.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8 — DailyCheckInPromptCron.
 *
 * Раз в час (`@Cron('0 * * * *')`) обходит всех employee-Person'ов с
 * привязанным User'ом и проверяет, не пора ли отправить morning/evening
 * checkin prompt:
 *
 *   - Морнинг — когда локальный час Person'а == `DAILY_CHECKIN_MORNING_LOCAL_HOUR`
 *     (default 9) и нет completed-чек-ина за сегодня (kind='morning').
 *   - Ивнинг — аналогично для `DAILY_CHECKIN_EVENING_LOCAL_HOUR` (default 18).
 *
 * Отправка: `ConversationalService.sendNotification(eventType='checkin.prompt')`.
 * Сохраняем notificationId в "пустом" DailyCheckIn (placeholder), чтобы при
 * ответе пользователя `CheckinResponseHandler` мог его найти.
 *
 * Anti-spam:
 *   - Unique constraint `(tenantId, personId, kind, dateLocal)` гарантирует,
 *     что для одного Person'а в один день не будет дубля.
 *   - Если уже есть completed чек-ин — пропускаем (метрика `skipped`).
 *
 * Мастер-флаг `DAILY_CHECKIN_ENABLED` (default true). При false cron
 * срабатывает, но сразу выходит. Это нужно, чтобы оператор мог включать
 * фичу без рестарта (запуск каждый час).
 */
@Injectable()
export class DailyCheckInPromptCron {
  private readonly logger = new Logger(DailyCheckInPromptCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DailyCheckInService)
    private readonly checkinService: DailyCheckInService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.dailyCheckInEnabled) {
      this.logger.debug('daily-checkin-prompt.cron: DAILY_CHECKIN_ENABLED=false, skip');
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(
        stats,
        'daily-checkin-prompt.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'daily-checkin-prompt.cron: непойманная ошибка',
      );
    }
  }

  /**
   * Выделен для unit-тестов: можно передать произвольный `now`.
   */
  async runOnce(now: Date): Promise<{
    promptsSent: number;
    skippedAlreadyCompleted: number;
    skippedOutsideWindow: number;
    skippedNoUser: number;
    errors: number;
  }> {
    const morningHour = this.cfg.betaOps.morningLocalHour;
    const eveningHour = this.cfg.betaOps.eveningLocalHour;

    // Берём все employee-Person'ы Org'ов с активным User'ом.
    const persons = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        relationship: 'employee',
        userId: { not: null },
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        timezone: true,
        name: true,
      },
      take: 5_000,
    });

    let promptsSent = 0;
    let skippedAlreadyCompleted = 0;
    let skippedOutsideWindow = 0;
    let skippedNoUser = 0;
    let errors = 0;

    for (const p of persons) {
      if (!p.userId) {
        skippedNoUser++;
        continue;
      }
      const localHour = getLocalHour(now, p.timezone);
      const localDate = getLocalDate(now, p.timezone);
      const tenantTop = resolveOperationsTenantTop(p.tenantId);

      const kind: 'morning' | 'evening' | null =
        localHour === morningHour
          ? 'morning'
          : localHour === eveningHour
            ? 'evening'
            : null;

      if (!kind) {
        skippedOutsideWindow++;
        continue;
      }

      const alreadyCompleted = await this.checkinService.hasCompletedToday({
        tenantId: p.tenantId,
        personId: p.id,
        kind,
        dateLocal: localDate,
      });
      if (alreadyCompleted) {
        skippedAlreadyCompleted++;
        this.metrics.incDailyCheckinSkipped({
          tenantTop,
          kind,
          reason: 'already_completed',
        });
        continue;
      }

      try {
        const question =
          kind === 'morning'
            ? 'Доброе утро! Какие 1-3 главные задачи на сегодня? Если есть блокеры — упомяни их.'
            : 'Добрый вечер! Что удалось закрыть сегодня? Есть ли блокеры на завтра?';

        const notification = await this.conversational.sendNotification({
          tenantId: p.tenantId,
          recipientUserId: p.userId,
          eventType: 'checkin.prompt',
          payload: {
            kind: 'checkin',
            checkInKind: kind,
            personId: p.id,
            dateLocal: localDate,
            question,
          },
          dataClass: 'internal',
        });

        await this.checkinService.createPromptPlaceholder({
          tenantId: p.tenantId,
          personId: p.id,
          kind,
          dateLocal: localDate,
          notificationId: notification.id,
        });
        promptsSent++;
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            personId: p.id,
            kind,
            err: err instanceof Error ? err.message : String(err),
          },
          'daily-checkin-prompt.cron: ошибка отправки',
        );
      }
    }

    return {
      promptsSent,
      skippedAlreadyCompleted,
      skippedOutsideWindow,
      skippedNoUser,
      errors,
    };
  }
}
