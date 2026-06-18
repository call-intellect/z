import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { EventsService } from './events.service';
import { FindFreeSlotService } from './find-free-slot.service';

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
    expect(r.slotStartAt).toBe('2026-06-01T08:00:00.000Z');
    expect(r.slotEndAt).toBe('2026-06-01T08:30:00.000Z');
  });

  it('workingHoursOnly=false → может быть в любое время', async () => {
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
    expect(r.slotStartAt).toBe('2026-06-01T19:00:00.000Z');
    expect(r.slotEndAt).toBe('2026-06-01T20:00:00.000Z');
  });

  it('не найдено за withinDays → found=false', async () => {
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
      personFindFirst.mockResolvedValue({
        timezone: 'Europe/Moscow',
        workStartHour: 10,
        workEndHour: 14,
        workingDays: [1, 2, 3, 4, 5],
      });
    });

    it('пустые busy → первый слот в 10:00 Москва (07:00Z), НЕ в 09:00 (now)', async () => {
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
      expect(r.slotStartAt).toBe('2026-06-02T07:00:00.000Z');
    });
  });
});
