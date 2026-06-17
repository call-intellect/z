import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { FindFreeSlotResponse } from '../dto/events.dto';

import { EventsService } from './events.service';

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

    const merged = this.mergeIntervals(allBusy);

    const organizerTz = await this.resolveOrganizerTimezone(args.participantUserIds[0]!);

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

  private firstWorkingHoursSubGap(args: {
    gap: { start: Date; end: Date };
    durationMs: number;
    timezone: string;
  }): { start: Date; end: Date } | null {
    const { gap, durationMs, timezone } = args;
    let cursor = new Date(gap.start);
    const MAX_DAYS = 14;
    for (let day = 0; day < MAX_DAYS; day++) {
      if (cursor >= gap.end) return null;

      const { startOfDayUtc, dayOfWeek } = this.localDayBounds(cursor, timezone);
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
      cursor = new Date(startOfDayUtc.getTime() + 24 * 60 * 60_000);
    }
    return null;
  }

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
      const wd = get('weekday');
      const wdMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayOfWeek = wdMap[wd] ?? 0;
      const sinceMidnight = ((hh * 60 + mm) * 60 + ss) * 1000;
      const startOfDayUtc = new Date(moment.getTime() - sinceMidnight);
      void y;
      void m;
      void d;
      return { startOfDayUtc, dayOfWeek };
    } catch {
      const startOfDayUtc = new Date(moment);
      startOfDayUtc.setUTCHours(0, 0, 0, 0);
      return { startOfDayUtc, dayOfWeek: moment.getUTCDay() };
    }
  }

  private mergeIntervals(
    intervals: Array<{ start: Date; end: Date }>,
  ): Array<{ start: Date; end: Date }> {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
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
