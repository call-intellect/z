import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { IcsFeedController } from './ics-feed.controller';
import type { EventsService } from './services/events.service';
import { IcsFeedService } from './services/ics-feed.service';

/**
 * Тесты IcsFeedController + IcsFeedService (Calendar MVP Фаза 2.2).
 *
 * Покрытие:
 *  1. invalid token → 404 (NotFoundException, не палим существование user).
 *  2. valid token, 2 events + 1 issue → правильное число VEVENT,
 *     корректное экранирование SUMMARY (запятая, точка с запятой,
 *     перенос строки).
 *  3. visibility=personal у owner — отдаётся в его собственном feed.
 *  4. Headers: Content-Type, Cache-Control, Content-Disposition.
 *  5. Структура VCALENDAR: BEGIN/END, VERSION, PRODID, CALSCALE, METHOD.
 */
describe('IcsFeedController + IcsFeedService', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let getEventsForFeed: ReturnType<typeof vi.fn>;

  let prisma: PrismaService;
  let events: EventsService;
  let svc: IcsFeedService;
  let ctrl: IcsFeedController;

  beforeEach(() => {
    userFindUnique = vi.fn();
    getEventsForFeed = vi.fn();

    prisma = {
      user: { findUnique: userFindUnique },
    } as unknown as PrismaService;

    events = {
      getEventsForFeed,
    } as unknown as EventsService;

    svc = new IcsFeedService(prisma, events);
    ctrl = new IcsFeedController(svc);
  });

  function makeRes() {
    const headers: Record<string, string> = {};
    const calls: { status?: number; body?: unknown } = {};
    const res = {
      setHeader: vi.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      status: vi.fn((code: number) => {
        calls.status = code;
        return res;
      }),
      send: vi.fn((body: unknown) => {
        calls.body = body;
        return res;
      }),
    };
    return { res, headers, calls };
  }

  describe('feed controller', () => {
    it('invalid token (user не найден) → 404', async () => {
      userFindUnique.mockResolvedValue(null);
      const { res } = makeRes();
      await expect(
        ctrl.feed('u-1', 'bad-token', res as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('invalid token (mismatch) → 404', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u-1',
        calendarFeedToken: 'real-token',
      });
      const { res } = makeRes();
      await expect(
        ctrl.feed('u-1', 'wrong-token', res as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('пустой token query → 404', async () => {
      const { res } = makeRes();
      await expect(
        ctrl.feed('u-1', undefined, res as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('null token у user (не сгенерирован) → 404', async () => {
      userFindUnique.mockResolvedValue({ id: 'u-1', calendarFeedToken: null });
      const { res } = makeRes();
      await expect(
        ctrl.feed('u-1', 'any', res as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('valid token: 2 events + 1 issue → 3 VEVENT блока + правильные headers', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u-1',
        calendarFeedToken: 'good-token',
      });
      getEventsForFeed.mockResolvedValue({
        events: [
          {
            id: 'e-1',
            title: 'Созвон с клиентом',
            startAt: new Date('2026-06-03T12:00:00Z'),
            endAt: new Date('2026-06-03T13:00:00Z'),
            durationMin: 60,
            description: null,
            location: null,
            status: 'confirmed',
            visibility: 'company',
            participants: [],
            reminders: [],
          },
          {
            id: 'e-2',
            title: 'Планёрка',
            startAt: new Date('2026-06-04T09:00:00Z'),
            endAt: null,
            durationMin: null,
            description: 'Обсуждение',
            location: 'Москва',
            status: 'tentative',
            visibility: 'team',
            participants: [],
            reminders: [],
          },
        ],
        issues: [
          {
            id: 'i-1',
            title: 'Подготовить отчёт',
            dueDate: new Date('2026-06-05T10:00:00Z'),
            project: { name: 'Z' },
          },
        ],
      });

      const { res, headers, calls } = makeRes();
      await ctrl.feed('u-1', 'good-token', res as never);

      expect(headers['Content-Type']).toBe('text/calendar; charset=utf-8');
      expect(headers['Cache-Control']).toBe('private, max-age=300');
      expect(headers['Content-Disposition']).toContain('kora-calendar.ics');
      expect(calls.status).toBe(200);

      const body = String(calls.body);
      // 3 VEVENT блока (2 события + 1 задача).
      const veventCount = (body.match(/BEGIN:VEVENT/g) ?? []).length;
      const veventEndCount = (body.match(/END:VEVENT/g) ?? []).length;
      expect(veventCount).toBe(3);
      expect(veventEndCount).toBe(3);

      // Структура VCALENDAR.
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body).toContain('VERSION:2.0');
      expect(body).toContain('PRODID:-//Kora//Calendar MVP//RU');
      expect(body).toContain('CALSCALE:GREGORIAN');
      expect(body).toContain('METHOD:PUBLISH');
      expect(body).toContain('END:VCALENDAR');

      // UIDs.
      expect(body).toContain('UID:event-e-1@kora.app');
      expect(body).toContain('UID:event-e-2@kora.app');
      expect(body).toContain('UID:issue-i-1@kora.app');

      // STATUS mapping.
      expect(body).toContain('STATUS:CONFIRMED');
      expect(body).toContain('STATUS:TENTATIVE');
      // Issue → TRANSP:TRANSPARENT.
      expect(body).toContain('TRANSP:TRANSPARENT');

      // Project name prefix у issue.
      expect(body).toContain('[Z] Подготовить отчёт');

      // CRLF разделители.
      expect(body).toContain('\r\n');
    });

    it('экранирование SUMMARY: запятая, точка с запятой, перенос строки, бэкслэш', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u-1',
        calendarFeedToken: 'good-token',
      });
      getEventsForFeed.mockResolvedValue({
        events: [
          {
            id: 'e-esc',
            title: 'A, B; C\\D\nE',
            startAt: new Date('2026-06-03T12:00:00Z'),
            endAt: new Date('2026-06-03T13:00:00Z'),
            durationMin: 60,
            description: 'line1\nline2',
            location: 'Москва, Кремль',
            status: 'confirmed',
            visibility: 'company',
            participants: [],
            reminders: [],
          },
        ],
        issues: [],
      });

      const { res, calls } = makeRes();
      await ctrl.feed('u-1', 'good-token', res as never);

      const body = String(calls.body);
      // RFC 5545: , → \, ; → \; \ → \\ \n → \n (литерал).
      expect(body).toContain('SUMMARY:A\\, B\\; C\\\\D\\nE');
      expect(body).toContain('DESCRIPTION:line1\\nline2');
      expect(body).toContain('LOCATION:Москва\\, Кремль');
    });

    it('personal-событие owner отдаётся в его feed (без маскировки)', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u-1',
        calendarFeedToken: 'good-token',
      });
      getEventsForFeed.mockResolvedValue({
        events: [
          {
            id: 'e-personal',
            title: 'Личное время',
            startAt: new Date('2026-06-03T15:00:00Z'),
            endAt: new Date('2026-06-03T16:00:00Z'),
            durationMin: 60,
            description: 'тайное',
            location: null,
            status: 'confirmed',
            visibility: 'personal',
            participants: [],
            reminders: [],
          },
        ],
        issues: [],
      });

      const { res, calls } = makeRes();
      await ctrl.feed('u-1', 'good-token', res as never);

      const body = String(calls.body);
      // Личный заголовок отдаётся, не маскируется как «Занято».
      expect(body).toContain('SUMMARY:Личное время');
      expect(body).toContain('DESCRIPTION:тайное');
    });

    it('DTSTART/DTSTAMP в UTC формате YYYYMMDDTHHmmssZ', async () => {
      userFindUnique.mockResolvedValue({
        id: 'u-1',
        calendarFeedToken: 'good-token',
      });
      getEventsForFeed.mockResolvedValue({
        events: [
          {
            id: 'e-dt',
            title: 'X',
            startAt: new Date('2026-06-03T12:34:56Z'),
            endAt: new Date('2026-06-03T13:34:56Z'),
            durationMin: 60,
            description: null,
            location: null,
            status: 'confirmed',
            visibility: 'company',
            participants: [],
            reminders: [],
          },
        ],
        issues: [],
      });

      const { res, calls } = makeRes();
      await ctrl.feed('u-1', 'good-token', res as never);

      const body = String(calls.body);
      expect(body).toContain('DTSTART:20260603T123456Z');
      expect(body).toContain('DTEND:20260603T133456Z');
      // DTSTAMP должен быть UTC формата
      expect(body).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });
  });

  describe('IcsFeedService.serialize (фолдинг длинных строк)', () => {
    it('строка > 75 байт разбивается с CRLF + space', () => {
      const longTitle = 'a'.repeat(120);
      const out = svc.serialize({
        events: [
          {
            id: 'e-long',
            title: longTitle,
            startAt: new Date('2026-06-03T12:00:00Z'),
            endAt: new Date('2026-06-03T13:00:00Z'),
            durationMin: 60,
            description: null,
            location: null,
            status: 'confirmed',
            visibility: 'company',
            participants: [],
            reminders: [],
          } as any,
        ],
        issues: [],
        now: new Date('2026-05-25T00:00:00Z'),
      });
      // После фолдинга — должна быть последовательность "\r\n " (CRLF + space).
      expect(out).toMatch(/\r\n /);
    });
  });
});
