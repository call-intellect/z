import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { FindFreeSlotResponse } from '../dto/events.dto';

import { EventsService } from './events.service';

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
 *   4. Если `workingHoursOnly` — фильтруем gap'ы по Пн-Пт 9:00-18:00 в
 *      timezone организатора (берём первого user'а в списке).
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

    // 3. Timezone организатора.
    const organizerTz = await this.resolveOrganizerTimezone(
      args.participantUserIds[0]!,
    );

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
   * Найти первый подгап в `gap`, который попадает в Пн-Пт 9:00-18:00 локальной
   * `timezone` и длится ≥ `durationMs`. Двигаемся по часам — берём минимально
   * допустимый старт.
   *
   * Реализация: разбиваем gap по дням локальной TZ; для каждого дня — если он
   * Пн-Пт, проверяем пересечение [day 9:00, day 18:00] с gap'ом; первый
   * подходящий подгап ≥ durationMs возвращаем.
   */
  private firstWorkingHoursSubGap(args: {
    gap: { start: Date; end: Date };
    durationMs: number;
    timezone: string;
  }): { start: Date; end: Date } | null {
    const { gap, durationMs, timezone } = args;
    let cursor = new Date(gap.start);
    const MAX_DAYS = 14; // safety: гэп не длиннее ~14 суток имеет смысл сканировать
    for (let day = 0; day < MAX_DAYS; day++) {
      if (cursor >= gap.end) return null;

      const { startOfDayUtc, dayOfWeek } = this.localDayBounds(cursor, timezone);
      // Понедельник=1 ... Пятница=5.
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const workStart = new Date(startOfDayUtc.getTime() + 9 * 60 * 60_000);
        const workEnd = new Date(startOfDayUtc.getTime() + 18 * 60 * 60_000);
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

  /**
   * Возвращает UTC-момент 00:00 локального дня + day-of-week (0=Sunday).
   * Реализация через Intl.DateTimeFormat (без зависимости от tz-библиотеки).
   *
   * Для timezones типа "Europe/Moscow" без DST даёт точный результат; для
   * TZ с DST (например, "Europe/Berlin") возможна ошибка в момент перехода —
   * для MVP-календаря приемлемо (расхождение ≤ 1 час раз в полгода).
   */
  private localDayBounds(
    moment: Date,
    timezone: string,
  ): { startOfDayUtc: Date; dayOfWeek: number } {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(moment);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const y = Number(get('year'));
      const m = Number(get('month'));
      const d = Number(get('day'));
      const hh = Number(get('hour'));
      const mm = Number(get('minute'));
      const ss = Number(get('second'));
      const wd = get('weekday'); // Mon, Tue, Wed...
      const wdMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const dayOfWeek = wdMap[wd] ?? 0;
      // Сколько ms прошло с локальной полуночи?
      const sinceMidnight = ((hh * 60 + mm) * 60 + ss) * 1000;
      const startOfDayUtc = new Date(moment.getTime() - sinceMidnight);
      void y;
      void m;
      void d;
      return { startOfDayUtc, dayOfWeek };
    } catch {
      // Fallback на UTC, если timezone невалидна.
      const startOfDayUtc = new Date(moment);
      startOfDayUtc.setUTCHours(0, 0, 0, 0);
      return { startOfDayUtc, dayOfWeek: moment.getUTCDay() };
    }
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
   * Резолвим timezone организатора (= первый user в списке).
   * Источники, в порядке приоритета:
   *   1. Person.timezone (связанный с user через ownerUserId).
   *   2. Org.timezone (первая Org user'а).
   *   3. 'Europe/Moscow' по умолчанию.
   */
  private async resolveOrganizerTimezone(userId: string): Promise<string> {
    const person = await this.prisma.person.findFirst({
      where: { userId, timezone: { not: null } },
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
}
