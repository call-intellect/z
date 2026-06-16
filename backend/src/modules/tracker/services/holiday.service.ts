import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

@Injectable()
export class HolidayService {
  private readonly logger = new Logger(HolidayService.name);

  private static readonly MAX_LOOKAHEAD_DAYS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async isHoliday(args: { tenantId: string | null; date: Date }): Promise<boolean> {
    const normalized = HolidayService.normalizeUtcDate(args.date);

    if (args.tenantId) {
      const override = await this.prisma.holidayCalendar.findFirst({
        where: { tenantId: args.tenantId, date: normalized },
      });
      if (override) {
        return !override.isWorking;
      }
    }

    const global = await this.prisma.holidayCalendar.findFirst({
      where: { tenantId: null, date: normalized },
    });
    if (global) {
      return !global.isWorking;
    }

    return HolidayService.isWeekend(normalized);
  }

  async nextBusinessDay(args: { tenantId: string | null; date: Date }): Promise<Date> {
    let candidate = HolidayService.normalizeUtcDate(args.date);
    for (let i = 0; i < HolidayService.MAX_LOOKAHEAD_DAYS; i += 1) {
      const holiday = await this.isHoliday({
        tenantId: args.tenantId,
        date: candidate,
      });
      if (!holiday) {
        return candidate;
      }
      candidate = HolidayService.addDaysUtc(candidate, 1);
    }
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

  async adjustDueDate(args: { tenantId: string | null; dueDate: Date }): Promise<Date> {
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

  private static normalizeUtcDate(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    );
  }

  private static addDaysUtc(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return HolidayService.normalizeUtcDate(next);
  }

  private static isWeekend(date: Date): boolean {
    const dow = date.getUTCDay();
    return dow === 0 || dow === 6;
  }
}
