import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { HolidayService } from './holiday.service';

/**
 * Mock PrismaService.holidayCalendar.findFirst — лукап по {tenantId, date}.
 *
 * Покрываем:
 *   1. isHoliday: per-tenant override побеждает глобальный.
 *   2. isHoliday: per-tenant override isWorking=true делает дату НЕ-праздником
 *      даже если день недели — суббота/воскресенье.
 *   3. isHoliday: fallback к глобальной записи при отсутствии override.
 *   4. isHoliday: без записей — выходные по дню недели.
 *   5. nextBusinessDay: пропускает выходные.
 *   6. adjustDueDate: если рабочий день — возвращает без сдвига и БЕЗ метрики.
 *   7. adjustDueDate: если праздник — сдвигает + инкремент метрики.
 */

interface HolidayRow {
  id: string;
  tenantId: string | null;
  date: Date;
  name: string;
  isWorking: boolean;
}

function makeService(holidays: HolidayRow[]): {
  svc: HolidayService;
  metrics: { incHolidayDueDateAdjusted: ReturnType<typeof vi.fn> };
} {
  const findFirst = vi.fn(async (args: { where: { tenantId: string | null; date: Date } }) => {
    const targetTime = args.where.date.getTime();
    return (
      holidays.find(
        (h) =>
          h.tenantId === args.where.tenantId && h.date.getTime() === targetTime,
      ) ?? null
    );
  });
  const prisma = {
    holidayCalendar: { findFirst },
  } as unknown as PrismaService;
  const metrics = {
    incHolidayDueDateAdjusted: vi.fn(),
  };
  const svc = new HolidayService(
    prisma,
    metrics as unknown as BusinessMetricsService,
  );
  return { svc, metrics };
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('HolidayService.isHoliday', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('per-tenant override — праздник побеждает глобальную запись', async () => {
    const { svc } = makeService([
      {
        id: 'h1',
        tenantId: 'tenant-A',
        date: utcDate('2026-03-09'),
        name: 'Тенант-выходной',
        isWorking: false,
      },
      // Глобальной для этой даты нет — но per-tenant override обязан сработать.
    ]);
    const result = await svc.isHoliday({
      tenantId: 'tenant-A',
      date: utcDate('2026-03-09'),
    });
    expect(result).toBe(true);
  });

  it('per-tenant override isWorking=true делает Sat/Sun рабочим', async () => {
    const sat = utcDate('2026-03-07'); // суббота
    const { svc } = makeService([
      {
        id: 'h2',
        tenantId: 'tenant-A',
        date: sat,
        name: 'Перенесённая рабочая суббота',
        isWorking: true,
      },
    ]);
    const result = await svc.isHoliday({ tenantId: 'tenant-A', date: sat });
    expect(result).toBe(false);
  });

  it('fallback к глобальной при отсутствии per-tenant override', async () => {
    const { svc } = makeService([
      {
        id: 'h3',
        tenantId: null,
        date: utcDate('2026-01-01'),
        name: 'Новый год',
        isWorking: false,
      },
    ]);
    const result = await svc.isHoliday({
      tenantId: 'tenant-A',
      date: utcDate('2026-01-01'),
    });
    expect(result).toBe(true);
  });

  it('без записей — выходные по дню недели (Sat=true, Mon=false)', async () => {
    const { svc } = makeService([]);
    expect(
      await svc.isHoliday({
        tenantId: null,
        date: utcDate('2026-03-07'), // суббота
      }),
    ).toBe(true);
    expect(
      await svc.isHoliday({
        tenantId: null,
        date: utcDate('2026-03-09'), // понедельник
      }),
    ).toBe(false);
  });
});

describe('HolidayService.nextBusinessDay', () => {
  it('возвращает саму дату если она рабочая', async () => {
    const { svc } = makeService([]);
    const monday = utcDate('2026-03-09');
    const result = await svc.nextBusinessDay({ tenantId: null, date: monday });
    expect(result.toISOString()).toBe(monday.toISOString());
  });

  it('пропускает Sat+Sun и возвращает понедельник', async () => {
    const { svc } = makeService([]);
    const sat = utcDate('2026-03-07');
    const result = await svc.nextBusinessDay({ tenantId: null, date: sat });
    expect(result.toISOString()).toBe(utcDate('2026-03-09').toISOString());
  });

  it('пропускает праздник и переходит на следующий рабочий день', async () => {
    // 1 января 2026 = чт, 2-8 — праздники. Первый рабочий день — 9 января (пт).
    const { svc } = makeService([
      { id: 'h1', tenantId: null, date: utcDate('2026-01-01'), name: 'НГ', isWorking: false },
      { id: 'h2', tenantId: null, date: utcDate('2026-01-02'), name: 'НГ', isWorking: false },
      { id: 'h3', tenantId: null, date: utcDate('2026-01-03'), name: 'НГ', isWorking: false },
      { id: 'h4', tenantId: null, date: utcDate('2026-01-04'), name: 'НГ', isWorking: false },
      { id: 'h5', tenantId: null, date: utcDate('2026-01-05'), name: 'НГ', isWorking: false },
      { id: 'h6', tenantId: null, date: utcDate('2026-01-06'), name: 'НГ', isWorking: false },
      { id: 'h7', tenantId: null, date: utcDate('2026-01-07'), name: 'Рождество', isWorking: false },
      { id: 'h8', tenantId: null, date: utcDate('2026-01-08'), name: 'НГ', isWorking: false },
    ]);
    const result = await svc.nextBusinessDay({
      tenantId: null,
      date: utcDate('2026-01-01'),
    });
    // 9 января 2026 — пятница.
    expect(result.toISOString()).toBe(utcDate('2026-01-09').toISOString());
  });
});

describe('HolidayService.adjustDueDate', () => {
  it('рабочий день — возвращает исходную дату, метрика НЕ растёт', async () => {
    const { svc, metrics } = makeService([]);
    const monday = utcDate('2026-03-09');
    const result = await svc.adjustDueDate({ tenantId: null, dueDate: monday });
    expect(result.toISOString()).toBe(monday.toISOString());
    expect(metrics.incHolidayDueDateAdjusted).not.toHaveBeenCalled();
  });

  it('праздник — сдвигает на след. рабочий и инкрементирует метрику', async () => {
    const { svc, metrics } = makeService([
      {
        id: 'h1',
        tenantId: null,
        date: utcDate('2026-01-01'),
        name: 'Новый год',
        isWorking: false,
      },
      {
        id: 'h2',
        tenantId: null,
        date: utcDate('2026-01-02'),
        name: 'НГ',
        isWorking: false,
      },
    ]);
    // 1 янв — праздник, 2 янв — праздник, 3-4 янв = Sat/Sun (выходные по дню недели — но в seed они есть; здесь не добавлены, проверим только до 5 янв; 5 янв 2026 = пн).
    const result = await svc.adjustDueDate({
      tenantId: null,
      dueDate: utcDate('2026-01-01'),
    });
    // 3 янв = сб, 4 янв = вс. nextBusinessDay начинает с 2 янв (праздник)→3 (сб)→4 (вс)→5 янв (пн, рабочий).
    expect(result.toISOString()).toBe(utcDate('2026-01-05').toISOString());
    expect(metrics.incHolidayDueDateAdjusted).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
    });
  });

  it('per-tenant override побеждает global для tenant', async () => {
    const friday = utcDate('2026-05-22'); // пятница, рабочая по дню недели
    const { svc, metrics } = makeService([
      {
        id: 'h1',
        tenantId: 'tenant-A',
        date: friday,
        name: 'Корпоратив',
        isWorking: false,
      },
    ]);
    const result = await svc.adjustDueDate({
      tenantId: 'tenant-A',
      dueDate: friday,
    });
    // Сдвиг на понедельник 25.05.
    expect(result.toISOString()).toBe(utcDate('2026-05-25').toISOString());
    expect(metrics.incHolidayDueDateAdjusted).toHaveBeenCalledTimes(1);
  });
});
