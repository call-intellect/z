import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { EventsService } from './events.service';
import { FindFreeSlotService } from './find-free-slot.service';

/**
 * Юнит-тесты FindFreeSlotService — Calendar MVP (2026-05-25) + Ф3
 * (assistant-calendar-master): рабочие часы/дни из профиля, не хардкод.
 *
 * Покрывают:
 *   1. Пустые busy-окна → возвращает первый working-hours слот (Пн 9:00 UTC+3).
 *   2. Один user полностью занят первые 3 дня → слот ищется на 4-й.
 *   3. Несколько user'ов с непересекающимися окнами → слот в общем gap'е.
 *   4. workingHoursOnly=false → слот может быть в любое время суток.
 *   5. Слот не найден за withinDays → found=false.
 *   6. Ф3 — кастомные рабочие часы Person (10-14) → слот не выдаётся вне окна.
 */
describe('FindFreeSlotService', () => {
  let svc: FindFreeSlotService;
  let prisma: PrismaService;
  let events: EventsService;
  let metrics: BusinessMetricsService;
  let cfg: TypedConfigService;

  let fetchBusyMock: ReturnType<typeof vi.fn>;
  let personFindFirst: ReturnType<typeof vi.fn>;
  let membershipFindFirst: ReturnType<typeof vi.fn>;
  let incFreeSlot: ReturnType<typeof vi.fn>;
  let getDynamic: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Фиксируем «сейчас» — понедельник 2026-06-01 06:00 UTC (= 09:00 Москва).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T06:00:00Z'));

    fetchBusyMock = vi.fn();
    personFindFirst = vi.fn().mockResolvedValue(null);
    membershipFindFirst = vi
      .fn()
      .mockResolvedValue({ org: { timezone: 'Europe/Moscow' } });

    prisma = {
      person: { findFirst: personFindFirst },
      membership: { findFirst: membershipFindFirst },
    } as unknown as PrismaService;

    events = {
      fetchBusyWindowsForUser: fetchBusyMock,
    } as unknown as EventsService;

    incFreeSlot = vi.fn();
    metrics = {
      incCalendarFindFreeSlot: incFreeSlot,
    } as unknown as BusinessMetricsService;

    // getDynamic возвращает дефолты рабочих часов/дней (как AdminSetting-seed):
    // work_hours_default_start=9, end=18, work_days_default=[1..5].
    getDynamic = vi.fn(
      async (key: string, _env: unknown, def: unknown): Promise<unknown> => {
        if (key === 'work_hours_default_start') return 9;
        if (key === 'work_hours_default_end') return 18;
        if (key === 'work_days_default') return [1, 2, 3, 4, 5];
        return def;
      },
    );
    cfg = { getDynamic } as unknown as TypedConfigService;

    svc = new FindFreeSlotService(prisma, events, metrics, cfg);
  });

  it('пустые busy → возвращает первый слот в working-hours', async () => {
    fetchBusyMock.mockResolvedValue([]);
    const r = await svc.findFreeSlot({
      tenantId: 't-1',
      participantUserIds: ['u-1'],
      durationMin: 60,
      workingHoursOnly: true,
    });
    expect(r.found).toBe(true);
    // Понедельник 09:00 Москва = 06:00 UTC (это совпадает с now → слот сразу).
    expect(r.slotStartAt).toBe('2026-06-01T06:00:00.000Z');
    expect(r.slotEndAt).toBe('2026-06-01T07:00:00.000Z');
    expect(incFreeSlot).toHaveBeenCalledWith({ tenant: 't-1', found: true });
  });

  it('user полностью занят первые 24 часа → ищет позже', async () => {
    fetchBusyMock.mockResolvedValue([
      {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    const r = await svc.findFreeSlot({
      tenantId: 't-1',
      participantUserIds: ['u-1'],
      durationMin: 60,
      workingHoursOnly: true,
    });
    expect(r.found).toBe(true);
    // Слот должен быть на вт 2026-06-02 09:00 Москва = 06:00 UTC.
    expect(r.slotStartAt).toBe('2026-06-02T06:00:00.000Z');
  });

  it('два user, busy не пересекается → ищет общий gap', async () => {
    fetchBusyMock.mockImplementation(async (args: { userId: string }) => {
      if (args.userId === 'u-1') {
        return [
          {
            start: new Date('2026-06-01T06:00:00Z'),
            end: new Date('2026-06-01T08:00:00Z'),
          },
        ];
      }
      return [
        {
          start: new Date('2026-06-01T08:30:00Z'),
          end: new Date('2026-06-01T10:00:00Z'),
        },
      ];
    });
    const r = await svc.findFreeSlot({
      tenantId: 't-1',
      participantUserIds: ['u-1', 'u-2'],
      durationMin: 30,
      workingHoursOnly: true,
    });
    expect(r.found).toBe(true);
    // Общий free gap: 08:00-08:30 UTC.
    expect(r.slotStartAt).toBe('2026-06-01T08:00:00.000Z');
    expect(r.slotEndAt).toBe('2026-06-01T08:30:00.000Z');
  });

  it('workingHoursOnly=false → может быть в любое время', async () => {
    // Утро понедельника всё занято — пусть свободно только полночь.
    fetchBusyMock.mockResolvedValue([
      {
        start: new Date('2026-06-01T06:00:00Z'),
        end: new Date('2026-06-01T19:00:00Z'),
      },
    ]);
    const r = await svc.findFreeSlot({
      tenantId: 't-1',
      participantUserIds: ['u-1'],
      durationMin: 60,
      workingHoursOnly: false,
    });
    expect(r.found).toBe(true);
    // Первый свободный момент: 19:00 UTC (после busy).
    expect(r.slotStartAt).toBe('2026-06-01T19:00:00.000Z');
    expect(r.slotEndAt).toBe('2026-06-01T20:00:00.000Z');
  });

  it('не найдено за withinDays → found=false', async () => {
    // Целиком занят весь горизонт.
    fetchBusyMock.mockResolvedValue([
      {
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-07-01T00:00:00Z'),
      },
    ]);
    const r = await svc.findFreeSlot({
      tenantId: 't-1',
      participantUserIds: ['u-1'],
      durationMin: 60,
      withinDays: 7,
    });
    expect(r.found).toBe(false);
    expect(r.slotStartAt).toBeNull();
    expect(incFreeSlot).toHaveBeenCalledWith({ tenant: 't-1', found: false });
  });

  describe('Ф3 — кастомные рабочие часы из профиля Person', () => {
    beforeEach(() => {
      // Person с TZ Moscow и нестандартным рабочим окном 10:00-14:00, Пн-Пт.
      // Оба вызова person.findFirst (профиль + резолв TZ) → этот же объект.
      personFindFirst.mockResolvedValue({
        timezone: 'Europe/Moscow',
        workStartHour: 10,
        workEndHour: 14,
        workingDays: [1, 2, 3, 4, 5],
      });
    });

    it('пустые busy → первый слот в 10:00 Москва (07:00Z), НЕ в 09:00 (now)', async () => {
      // now = пн 09:00 Москва (06:00Z). При дефолте 9-18 слот был бы в 06:00Z;
      // при кастомном окне 10-14 — не раньше 10:00 Москва = 07:00Z.
      fetchBusyMock.mockResolvedValue([]);
      const r = await svc.findFreeSlot({
        tenantId: 't-1',
        participantUserIds: ['u-1'],
        durationMin: 60,
        workingHoursOnly: true,
      });
      expect(r.found).toBe(true);
      expect(r.slotStartAt).toBe('2026-06-01T07:00:00.000Z');
      expect(r.slotEndAt).toBe('2026-06-01T08:00:00.000Z');
    });

    it('свободно только 14:00-15:00 Москва (вне окна 10-14) → слот переносится на следующий день', async () => {
      // Занято пн 06:00Z..11:00Z (= 09:00-14:00 Москва) и далее весь вечер
      // 11:00Z..21:00Z, т.е. в пн в окне 10-14 свободного нет. Слот должен
      // уйти на вт 10:00 Москва (2026-06-02T07:00:00Z).
      fetchBusyMock.mockResolvedValue([
        {
          start: new Date('2026-06-01T06:00:00Z'),
          end: new Date('2026-06-01T21:00:00Z'),
        },
      ]);
      const r = await svc.findFreeSlot({
        tenantId: 't-1',
        participantUserIds: ['u-1'],
        durationMin: 60,
        workingHoursOnly: true,
      });
      expect(r.found).toBe(true);
      // Вторник 10:00 Москва = 07:00Z (не пн-вечер вне окна).
      expect(r.slotStartAt).toBe('2026-06-02T07:00:00.000Z');
    });
  });
});
