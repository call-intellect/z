import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { localDayBoundsUtc } from '../../operations/utils/local-date';
import type { FindFreeSlotResponse } from '../dto/events.dto';

import { EventsService } from './events.service';

const DEFAULT_WORK_START_HOUR = 9;
const DEFAULT_WORK_END_HOUR = 18;
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

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

    const organizer = await this.resolveOrganizerProfile(
      args.participantUserIds[0]!,
      args.tenantId,
    );
    const organizerTz = organizer.timezone;

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
    const MAX_DAYS = 14;
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
