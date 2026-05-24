import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

/**
 * HolidayService — проверка попадания даты на праздник / выходной и
 * автоперенос на следующий рабочий день. Wave 3 / Tracker Phase 4 part 2.
 *
 * Источник данных — модель `HolidayCalendar`:
 *   - tenantId=null — глобальный РФ-календарь (seed-скрипт
 *     `backend/scripts/seed-holiday-calendar-ru-2026.ts`).
 *   - tenantId=<org> — per-tenant override (можно добавить через
 *     `HolidaysController.create` под RBAC).
 *
 * Лукап делается по `@@unique([tenantId, date])`: сначала per-tenant override,
 * потом fallback к глобальной записи.
 *
 * Метрика: `holiday_due_date_adjusted_total{tenant_top}` — инкремент при
 * срабатывании `adjustDueDate` (т.е. фактическом сдвиге).
 *
 * Интеграция с IssuesService — см. отчёт оркестратора Sprint 9
 * (точные диффы; в этом ТЗ только HolidayService без модификации
 * IssuesService).
 */
@Injectable()
export class HolidayService {
  private readonly logger = new Logger(HolidayService.name);

  /** Защитный лимит шагов рекурсии (нельзя зацикливаться). */
  private static readonly MAX_LOOKAHEAD_DAYS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Праздник ли указанная дата? Логика:
   *   1. Per-tenant override → если найден и `isWorking=false` → праздник.
   *   2. Per-tenant override `isWorking=true` (перенесённая рабочая суббота) → НЕ праздник.
   *   3. Если override нет — fallback к глобальной (tenantId=null) записи.
   *   4. Если и глобальной нет — выходной только по дню недели (Sat/Sun).
   */
  async isHoliday(args: {
    tenantId: string | null;
    date: Date;
  }): Promise<boolean> {
    const normalized = HolidayService.normalizeUtcDate(args.date);

    // 1. Per-tenant override.
    if (args.tenantId) {
      const override = await this.prisma.holidayCalendar.findFirst({
        where: { tenantId: args.tenantId, date: normalized },
      });
      if (override) {
        // Если override — рабочая суббота (isWorking=true) — это НЕ праздник.
        return !override.isWorking;
      }
    }

    // 2. Глобальная запись.
    const global = await this.prisma.holidayCalendar.findFirst({
      where: { tenantId: null, date: normalized },
    });
    if (global) {
      return !global.isWorking;
    }

    // 3. Нет записей — проверим день недели.
    return HolidayService.isWeekend(normalized);
  }

  /**
   * Найти следующий рабочий день начиная с `date` (включая саму дату, если
   * она рабочая). Используется как «пол» для adjustDueDate и для cycle-end-date.
   */
  async nextBusinessDay(args: {
    tenantId: string | null;
    date: Date;
  }): Promise<Date> {
    let candidate = HolidayService.normalizeUtcDate(args.date);
    for (let i = 0; i < HolidayService.MAX_LOOKAHEAD_DAYS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const holiday = await this.isHoliday({
        tenantId: args.tenantId,
        date: candidate,
      });
      if (!holiday) {
        return candidate;
      }
      candidate = HolidayService.addDaysUtc(candidate, 1);
    }
    // Фолбэк: чтобы не зависнуть навсегда — возвращаем последний кандидат +
    // лог-предупреждение. Можно превышение порога ловить отдельной метрикой.
    this.logger.warn(
      {
        tenantId: args.tenantId,
        startDate: args.date.toISOString(),
        maxLookaheadDays: HolidayService.MAX_LOOKAHEAD_DAYS,
      },
      'nextBusinessDay: достигнут лимит поиска, возвращаем последний кандидат',
    );
    return candidate;
  }

  /**
   * Скорректировать `dueDate`: если она попадает на праздник/выходной —
   * сдвинуть на ближайший следующий рабочий день и вернуть его.
   * Иначе — вернуть исходную дату как есть.
   *
   * Инкрементирует метрику `holiday_due_date_adjusted_total{tenant_top}` ТОЛЬКО
   * при фактическом сдвиге (если возвращается исходная — метрика не растёт).
   */
  async adjustDueDate(args: {
    tenantId: string | null;
    dueDate: Date;
  }): Promise<Date> {
    const normalized = HolidayService.normalizeUtcDate(args.dueDate);
    const holiday = await this.isHoliday({
      tenantId: args.tenantId,
      date: normalized,
    });
    if (!holiday) {
      return normalized;
    }
    const adjusted = await this.nextBusinessDay({
      tenantId: args.tenantId,
      date: HolidayService.addDaysUtc(normalized, 1),
    });
    this.metrics?.incHolidayDueDateAdjusted({
      tenantTop: tenantTopOf(args.tenantId),
    });
    return adjusted;
  }

  // ── helpers ──

  /** YYYY-MM-DD → Date at UTC midnight. Применяем перед сравнением с БД. */
  private static normalizeUtcDate(date: Date): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
  }

  private static addDaysUtc(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return HolidayService.normalizeUtcDate(next);
  }

  private static isWeekend(date: Date): boolean {
    const dow = date.getUTCDay();
    // Sunday=0, Saturday=6.
    return dow === 0 || dow === 6;
  }
}
