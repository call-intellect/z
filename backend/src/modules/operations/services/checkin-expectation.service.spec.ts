import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { HolidayService } from '../../tracker/services/holiday.service';
import type { PersonLeaveService } from '../../tracker/services/person-leave.service';

import { CheckinExpectationService } from './checkin-expectation.service';
import type { DailyCheckInService } from './daily-checkin.service';

const MONDAY = '2026-06-29';
const SATURDAY = '2026-06-27';

function makeService() {
  const findMany = vi.fn();
  const prisma = { person: { findMany } };
  const ensureExpectationRow = vi.fn().mockResolvedValue({});
  const checkins = { ensureExpectationRow };
  const isHoliday = vi.fn().mockResolvedValue(false);
  const holiday = { isHoliday };
  const isOnLeave = vi.fn().mockResolvedValue(false);
  const personLeave = { isOnLeave };
  const service = new CheckinExpectationService(
    prisma as unknown as PrismaService,
    checkins as unknown as DailyCheckInService,
    holiday as unknown as HolidayService,
    personLeave as unknown as PersonLeaveService,
  );
  return { service, findMany, ensureExpectationRow, isHoliday, isOnLeave };
}

describe('CheckinExpectationService.ensureForDay', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it('рабочий день (Пн), сотрудник без отпуска → ensureExpectationRow для morning и evening', async () => {
    const { service, findMany, ensureExpectationRow } = ctx;
    findMany.mockResolvedValueOnce([{ id: 'p1', workingDays: [] }]);

    const res = await service.ensureForDay({ tenantId: 't1', dateLocal: MONDAY });

    expect(ensureExpectationRow).toHaveBeenCalledTimes(2);
    expect(ensureExpectationRow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', personId: 'p1', kind: 'morning', dateLocal: MONDAY }),
    );
    expect(ensureExpectationRow).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', personId: 'p1', kind: 'evening', dateLocal: MONDAY }),
    );
    expect(res).toEqual({ created: 2, employees: 1, skippedNonWorking: 0 });
  });

  it('выходной (Сб) для сотрудника с дефолтными рабочими днями → ожидания не создаются', async () => {
    const { service, findMany, ensureExpectationRow } = ctx;
    findMany.mockResolvedValueOnce([{ id: 'p1', workingDays: [] }]);

    const res = await service.ensureForDay({ tenantId: 't1', dateLocal: SATURDAY });

    expect(ensureExpectationRow).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, employees: 1, skippedNonWorking: 1 });
  });

  it('праздник → ранний выход, findMany не вызывается, ожидания не создаются', async () => {
    const { service, findMany, ensureExpectationRow, isHoliday } = ctx;
    isHoliday.mockResolvedValueOnce(true);

    const res = await service.ensureForDay({ tenantId: 't1', dateLocal: MONDAY });

    expect(findMany).not.toHaveBeenCalled();
    expect(ensureExpectationRow).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, employees: 0, skippedNonWorking: 0 });
  });

  it('сотрудник в отпуске → его ожидания не создаются', async () => {
    const { service, findMany, ensureExpectationRow, isOnLeave } = ctx;
    findMany.mockResolvedValueOnce([{ id: 'p1', workingDays: [] }]);
    isOnLeave.mockResolvedValueOnce(true);

    const res = await service.ensureForDay({ tenantId: 't1', dateLocal: MONDAY });

    expect(ensureExpectationRow).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, employees: 1, skippedNonWorking: 1 });
  });
});
