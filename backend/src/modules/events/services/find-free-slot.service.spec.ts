import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { EventsService } from './events.service';
import { FindFreeSlotService } from './find-free-slot.service';

/**
 * Юнит-тесты FindFreeSlotService — Calendar MVP (2026-05-25).
 *
 * Покрывают:
 *   1. Пустые busy-окна → возвращает первый working-hours слот (Пн 9:00 UTC+3).
 *   2. Один user полностью занят первые 3 дня → слот ищется на 4-й.
 *   3. Несколько user'ов с непересекающимися окнами → слот в общем gap'е.
 *   4. workingHoursOnly=false → слот может быть в любое время суток.
 *   5. Слот не найден за withinDays → found=false.
 */
describe('FindFreeSlotService', () => {
  let svc: FindFreeSlotService;
  let prisma: PrismaService;
  let events: EventsService;
  let metrics: BusinessMetricsService;

  let fetchBusyMock: ReturnType<typeof vi.fn>;
  let personFindFirst: ReturnType<typeof vi.fn>;
  let membershipFindFirst: ReturnType<typeof vi.fn>;
  let incFreeSlot: ReturnType<typeof vi.fn>;

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

    svc = new FindFreeSlotService(prisma, events, metrics);
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
});
