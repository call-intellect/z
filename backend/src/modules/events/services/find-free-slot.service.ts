import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { localDayBoundsUtc } from '../../operations/utils/local-date';
import type { FindFreeSlotResponse } from '../dto/events.dto';

import { EventsService } from './events.service';

/**
 * Ф3 (ТЗ assistant-calendar-master) — дефолты рабочих часов (AdminSetting /
 * getDynamic). Служат code-fallback'ом, если AdminSetting не отвечает (а также
 * в unit-тестах с cfg-моком без `getDynamic`). Дублируют seed дефолтных
 * рабочих часов/дней (Ф4-seed); НЕ источник правды, а страховка.
 */
const DEFAULT_WORK_START_HOUR = 9;
const DEFAULT_WORK_END_HOUR = 18;
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Пн..Пт (0=вс..6=сб)

/**
 * Calendar MVP (2026-05-25) — поиск общего свободного слота среди
 * нескольких пользователей.
 *
 * Алгоритм:
 *   1. Окно = [now, now + withinDays × 24h].
 *   2. Для каждого user'а собираем busy-окна: Event.startAt-endAt (где user
 *      owner ИЛИ participant) + Issue.dueDate (как 30-минутный busy-block).
 *      Делегируем сбор `EventsService.fetchBusyWindowsForUser`.
 *   3. Сортируем + сливаем перекрытия (объединение интервалов).
 *   4. Если `workingHoursOnly` — фильтруем gap'ы по рабочим часам/дням профиля
 *      организатора (берём первого user'а; Ф3 — не хардкод Пн-Пт 9-18, а
 *      Person.workStartHour/workEndHour/workingDays + дефолты AdminSetting) в
 *      его timezone.
 *   5. Возвращаем первый gap длиной ≥ durationMin.
 */
@Injectable()
export class FindFreeSlotService {
  private readonly logger = new Logger(FindFreeSlotService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async findFreeSlot(args: {
    tenantId: string;
    participantUserIds: string[];
    durationMin: number;
    withinDays?: number;
    workingHoursOnly?: boolean;
  }): Promise<FindFreeSlotResponse> {
    const withinDays = args.withinDays ?? 7;
    const workingHoursOnly = args.workingHoursOnly ?? true;
    const durationMs = args.durationMin * 60_000;

    const from = new Date();
    const to = new Date(from.getTime() + withinDays * 24 * 60 * 60_000);

    // 1. Соберём busy-окна по каждому участнику.
    const allBusy: Array<{ start: Date; end: Date }> = [];
    for (const userId of args.participantUserIds) {
      const windows = await this.events.fetchBusyWindowsForUser({
        tenantId: args.tenantId,
        userId,
        from,
        to,
      });
      for (const w of windows) {
        if (w.end <= from || w.start >= to) continue;
        const clamped = {
          start: w.start < from ? from : w.start,
          end: w.end > to ? to : w.end,
        };
        if (clamped.end > clamped.start) allBusy.push(clamped);
      }
    }

    // 2. Сортируем + сливаем перекрытия.
    const merged = this.mergeIntervals(allBusy);

    // 3. Профиль организатора (= первый user): TZ + рабочие часы/дни.
    //    Ф3 — больше не хардкодим Пн-Пт 9-18; берём из Person (+ дефолты
    //    AdminSetting). MVP: профиль первого участника.
    const organizer = await this.resolveOrganizerProfile(
      args.participantUserIds[0]!,
      args.tenantId,
    );
    const organizerTz = organizer.timezone;

    // 4. Идём по gap'ам [from..busy1.start], [busy1.end..busy2.start], ...
    //    [busyN.end..to], ищем первый длинный достаточно.
    const gaps: Array<{ start: Date; end: Date }> = [];
    let cursor = from;
    for (const b of merged) {
      if (b.start > cursor) {
        gaps.push({ start: cursor, end: b.start });
      }
      cursor = b.end > cursor ? b.end : cursor;
    }
    if (cursor < to) {
      gaps.push({ start: cursor, end: to });
    }

    for (const g of gaps) {
      const candidate = workingHoursOnly
        ? this.firstWorkingHoursSubGap({
            gap: g,
            durationMs,
            timezone: organizerTz,
            workStartHour: organizer.workStartHour,
            workEndHour: organizer.workEndHour,
            workingDays: organizer.workingDays,
          })
        : g.end.getTime() - g.start.getTime() >= durationMs
          ? { start: g.start, end: new Date(g.start.getTime() + durationMs) }
          : null;
      if (candidate) {
        this.metrics.incCalendarFindFreeSlot({
          tenant: args.tenantId,
          found: true,
        });
        return {
          slotStartAt: candidate.start.toISOString(),
          slotEndAt: candidate.end.toISOString(),
          found: true,
        };
      }
    }

    this.metrics.incCalendarFindFreeSlot({
      tenant: args.tenantId,
      found: false,
    });
    return { slotStartAt: null, slotEndAt: null, found: false };
  }

  /**
   * Найти первый подгап в `gap`, который попадает в рабочие часы/дни локальной
   * `timezone` и длится ≥ `durationMs`. Двигаемся по часам — берём минимально
   * допустимый старт.
   *
   * Ф3 — рабочие часы/дни приходят параметрами (профиль организатора), а НЕ
   * хардкодом Пн-Пт 9-18. Реализация: разбиваем gap по дням локальной TZ; для
   * каждого дня — если он рабочий (`workingDays.includes(dow)`), проверяем
   * пересечение [day workStartHour, day workEndHour] с gap'ом; первый
   * подходящий подгап ≥ durationMs возвращаем.
   */
  private firstWorkingHoursSubGap(args: {
    gap: { start: Date; end: Date };
    durationMs: number;
    timezone: string;
    workStartHour: number;
    workEndHour: number;
    workingDays: number[];
  }): { start: Date; end: Date } | null {
    const { gap, durationMs, timezone, workStartHour, workEndHour, workingDays } =
      args;
    let cursor = new Date(gap.start);
    const MAX_DAYS = 14; // safety: гэп не длиннее ~14 суток имеет смысл сканировать
    for (let day = 0; day < MAX_DAYS; day++) {
      if (cursor >= gap.end) return null;

      const { startOfDayUtc, dayOfWeek } = localDayBoundsUtc(cursor, timezone);
      if (workingDays.includes(dayOfWeek)) {
        const workStart = new Date(
          startOfDayUtc.getTime() + workStartHour * 60 * 60_000,
        );
        const workEnd = new Date(
          startOfDayUtc.getTime() + workEndHour * 60 * 60_000,
        );
        const subStart = cursor > workStart ? cursor : workStart;
        const subEnd = gap.end < workEnd ? gap.end : workEnd;
        if (subEnd.getTime() - subStart.getTime() >= durationMs) {
          return {
            start: subStart,
            end: new Date(subStart.getTime() + durationMs),
          };
        }
      }
      // Двигаемся на начало следующего календарного дня (по local TZ).
      cursor = new Date(startOfDayUtc.getTime() + 24 * 60 * 60_000);
    }
    return null;
  }

  private mergeIntervals(
    intervals: Array<{ start: Date; end: Date }>,
  ): Array<{ start: Date; end: Date }> {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    const out: Array<{ start: Date; end: Date }> = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      const last = out[out.length - 1]!;
      const cur = sorted[i]!;
      if (cur.start <= last.end) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        out.push({ start: cur.start, end: cur.end });
      }
    }
    return out;
  }

  /**
   * Ф3 — резолвим РАБОЧИЙ ПРОФИЛЬ организатора (= первый user в списке):
   * таймзона + рабочие часы/дни. Источники:
   *   - timezone: Person.timezone → Org.timezone → 'Europe/Moscow'
   *     (делегируем `resolveOrganizerTimezone`);
   *   - workStartHour/workEndHour/workingDays: из Person, иначе дефолты
   *     AdminSetting (getDynamic) с code-fallback.
   * `workingDays = []` (поле не задано) трактуем как «дефолт».
   */
  private async resolveOrganizerProfile(
    userId: string,
    tenantId: string,
  ): Promise<{
    timezone: string;
    workStartHour: number;
    workEndHour: number;
    workingDays: number[];
  }> {
    const person = await this.prisma.person.findFirst({
      where: { userId, tenantId },
      select: {
        timezone: true,
        workStartHour: true,
        workEndHour: true,
        workingDays: true,
      },
    });

    const timezone = await this.resolveOrganizerTimezone(userId, tenantId);

    const workStartHour =
      person?.workStartHour ??
      (await this.getWorkHourDefault('work_hours_default_start', DEFAULT_WORK_START_HOUR));
    const workEndHour =
      person?.workEndHour ??
      (await this.getWorkHourDefault('work_hours_default_end', DEFAULT_WORK_END_HOUR));
    const workingDays =
      person?.workingDays && person.workingDays.length > 0
        ? person.workingDays
        : await this.getWorkingDaysDefault();

    return { timezone, workStartHour, workEndHour, workingDays };
  }

  /**
   * Резолвим timezone организатора (= первый user в списке).
   * Источники, в порядке приоритета:
   *   1. Person.timezone (связанный с user через userId, в рамках tenant'а).
   *   2. Org.timezone (первая Org user'а).
   *   3. 'Europe/Moscow' по умолчанию.
   */
  private async resolveOrganizerTimezone(
    userId: string,
    tenantId: string,
  ): Promise<string> {
    const person = await this.prisma.person.findFirst({
      where: { userId, tenantId, timezone: { not: null } },
      select: { timezone: true },
    });
    if (person?.timezone) return person.timezone;

    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      select: { org: { select: { timezone: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return membership?.org?.timezone ?? 'Europe/Moscow';
  }

  /**
   * Дефолтный рабочий час (start/end) из AdminSetting (getDynamic).
   * Defensive try/catch — cfg-мок в тестах может не иметь `getDynamic`.
   */
  private async getWorkHourDefault(
    key: 'work_hours_default_start' | 'work_hours_default_end',
    fallback: number,
  ): Promise<number> {
    try {
      const v = await this.cfg.getDynamic<number>(key, undefined, fallback);
      return Number.isFinite(v) ? v : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Дефолтные рабочие дни (0=вс..6=сб) из AdminSetting (getDynamic).
   * Defensive try/catch — cfg-мок в тестах может не иметь `getDynamic`.
   */
  private async getWorkingDaysDefault(): Promise<number[]> {
    try {
      const v = await this.cfg.getDynamic<number[]>(
        'work_days_default',
        undefined,
        DEFAULT_WORKING_DAYS,
      );
      return Array.isArray(v) && v.length > 0 ? v : DEFAULT_WORKING_DAYS;
    } catch {
      return DEFAULT_WORKING_DAYS;
    }
  }
}
