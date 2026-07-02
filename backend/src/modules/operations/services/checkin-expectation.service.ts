import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { HolidayService } from '../../tracker/services/holiday.service';
import { PersonLeaveService } from '../../tracker/services/person-leave.service';

import { DailyCheckInService } from './daily-checkin.service';

@Injectable()
export class CheckinExpectationService {
  private readonly logger = new Logger(CheckinExpectationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DailyCheckInService) private readonly checkins: DailyCheckInService,
    @Inject(HolidayService) private readonly holiday: HolidayService,
    @Inject(PersonLeaveService) private readonly personLeave: PersonLeaveService,
  ) {}

  async ensureForDay(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<{ created: number; employees: number; skippedNonWorking: number }> {
    const localDayStart = new Date(`${args.dateLocal}T00:00:00.000Z`);
    const dayOfWeek = new Date(`${args.dateLocal}T12:00:00.000Z`).getUTCDay();

    const holiday = await this.holiday.isHoliday({
      tenantId: args.tenantId,
      date: localDayStart,
    });
    if (holiday) {
      this.logger.debug(
        { tenantId: args.tenantId, dateLocal: args.dateLocal },
        'checkin-expectation: день — праздник, ожиданий не создаём',
      );
      return { created: 0, employees: 0, skippedNonWorking: 0 };
    }

    const employees = await this.prisma.person.findMany({
      where: { tenantId: args.tenantId, deletedAt: null, relationship: 'employee' },
      select: { id: true, workingDays: true },
    });

    let created = 0;
    let skippedNonWorking = 0;

    for (const emp of employees) {
      try {
        const wd = emp.workingDays.length ? emp.workingDays : [1, 2, 3, 4, 5];
        if (!wd.includes(dayOfWeek)) {
          skippedNonWorking++;
          continue;
        }
        const onLeave = await this.personLeave.isOnLeave({
          tenantId: args.tenantId,
          personId: emp.id,
          date: localDayStart,
        });
        if (onLeave) {
          skippedNonWorking++;
          continue;
        }
        await this.checkins.ensureExpectationRow({
          tenantId: args.tenantId,
          personId: emp.id,
          kind: 'morning',
          dateLocal: args.dateLocal,
        });
        await this.checkins.ensureExpectationRow({
          tenantId: args.tenantId,
          personId: emp.id,
          kind: 'evening',
          dateLocal: args.dateLocal,
        });
        created += 2;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            personId: emp.id,
            dateLocal: args.dateLocal,
            err: err instanceof Error ? err.message : String(err),
          },
          'checkin-expectation: сотрудник пропущен (best-effort)',
        );
      }
    }

    this.logger.debug(
      {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
        employees: employees.length,
        created,
        skippedNonWorking,
      },
      'checkin-expectation: ожидания на день обеспечены',
    );

    return { created, employees: employees.length, skippedNonWorking };
  }
}
