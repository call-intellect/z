import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import type { MeetingsService } from '../../meetings/meetings.service';

import { EventsService } from './events.service';

/**
 * Юнит-тесты EventsService — Calendar MVP (2026-05-25).
 *
 * Покрывают:
 *   1.  create — создаёт Entity + Event + дефолтные reminders (для kind=meeting).
 *   2.  create с visibility='personal' — без эмита event.created.
 *   3.  update — owner может, чужой не может.
 *   4.  update — organizer (через EventParticipant.role='organizer') может.
 *   5.  softDelete — выставляет deletedAt + status='cancelled'.
 *   6.  rsvp — обновляет EventParticipant.rsvp.
 *   7.  rsvp — non-participant получает ForbiddenException.
 *   8.  getMyCalendar — миксует Events + Issues.
 *   9.  getUserCalendar — personal-события другого user маскируются как «Занято».
 */
describe('EventsService', () => {
  let prisma: PrismaService;
  let entityResolver: EntityResolutionService;
  let metrics: BusinessMetricsService;
  let svc: EventsService;
  let emitMock: ReturnType<typeof vi.fn>;

  let txEventCreate: ReturnType<typeof vi.fn>;
  let txParticipantCreateMany: ReturnType<typeof vi.fn>;
  let txReminderCreateMany: ReturnType<typeof vi.fn>;
  let txEventFindUnique: ReturnType<typeof vi.fn>;

  let eventFindUnique: ReturnType<typeof vi.fn>;
  let eventUpdate: ReturnType<typeof vi.fn>;
  let eventFindMany: ReturnType<typeof vi.fn>;
  let issueFindMany: ReturnType<typeof vi.fn>;
  let participantFindFirst: ReturnType<typeof vi.fn>;
  let participantUpdate: ReturnType<typeof vi.fn>;

  let entityFindOrCreate: ReturnType<typeof vi.fn>;
  let incCreated: ReturnType<typeof vi.fn>;

  // Ф3 — резолв таймзоны человека (Person.timezone → Org.timezone → Moscow).
  let personFindFirst: ReturnType<typeof vi.fn>;
  let membershipFindFirst: ReturnType<typeof vi.fn>;

  let meetingsCreateForCalendarEvent: ReturnType<typeof vi.fn>;
  let meetingsCancelScheduled: ReturnType<typeof vi.fn>;
  let meetings: MeetingsService;

  function makeEvent(
    over: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      id: 'e-1',
      tenantId: 't-1',
      entityId: 'ent-1',
      ownerId: 'u-owner',
      kind: 'meeting',
      title: 'Test',
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T11:00:00Z'),
      durationMin: 60,
      description: null,
      location: null,
      participantsPersonIds: [],
      relatedMeetingId: null,
      online: false,
      counterparty: null,
      outcomeSummary: null,
      metadata: null,
      allDay: false,
      timezone: 'Europe/Moscow',
      rrule: null,
      status: 'confirmed',
      visibility: 'company',
      externalProvider: null,
      externalEventId: null,
      projectId: null,
      createdAt: new Date('2026-05-25T00:00:00Z'),
      updatedAt: new Date('2026-05-25T00:00:00Z'),
      deletedAt: null,
      participants: [],
      reminders: [],
      ...over,
    };
  }

  beforeEach(() => {
    txEventCreate = vi.fn();
    txParticipantCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    txReminderCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    txEventFindUnique = vi.fn();

    eventFindUnique = vi.fn();
    eventUpdate = vi.fn();
    eventFindMany = vi.fn();
    issueFindMany = vi.fn();
    participantFindFirst = vi.fn();
    participantUpdate = vi.fn();

    // По умолчанию профиль/TZ человека не задан → резолв упадёт на Moscow.
    personFindFirst = vi.fn().mockResolvedValue(null);
    membershipFindFirst = vi.fn().mockResolvedValue(null);

    const $transaction = vi.fn().mockImplementation(async (cb: unknown) => {
      const tx = {
        event: {
          create: txEventCreate,
          findUnique: txEventFindUnique,
        },
        eventParticipant: { createMany: txParticipantCreateMany },
        eventReminder: { createMany: txReminderCreateMany },
      };
      return (cb as (t: unknown) => Promise<unknown>)(tx);
    });

    prisma = {
      $transaction,
      event: {
        findUnique: eventFindUnique,
        update: eventUpdate,
        findMany: eventFindMany,
      },
      eventParticipant: {
        findFirst: participantFindFirst,
        update: participantUpdate,
      },
      issue: {
        findMany: issueFindMany,
      },
      person: { findFirst: personFindFirst },
      membership: { findFirst: membershipFindFirst },
    } as unknown as PrismaService;

    meetingsCreateForCalendarEvent = vi
      .fn()
      .mockResolvedValue({ meetingId: 'm-1', joinUrl: 'https://app/m/m-1' });
    meetingsCancelScheduled = vi.fn().mockResolvedValue(undefined);
    meetings = {
      createForCalendarEvent: meetingsCreateForCalendarEvent,
      cancelScheduledForCalendarEvent: meetingsCancelScheduled,
    } as unknown as MeetingsService;

    entityFindOrCreate = vi
      .fn()
      .mockResolvedValue({ entity: { id: 'ent-1' }, created: true });
    entityResolver = {
      findOrCreateEntity: entityFindOrCreate,
    } as unknown as EntityResolutionService;

    incCreated = vi.fn();
    metrics = {
      incCalendarEventCreated: incCreated,
    } as unknown as BusinessMetricsService;

    emitMock = vi.fn();

    svc = new EventsService(prisma, entityResolver, metrics, meetings, {
      emit: emitMock,
    } as never);
  });

  describe('create', () => {
    it('создаёт Entity + Event + дефолтные reminders для kind=meeting', async () => {
      const created = makeEvent({
        id: 'e-new',
        reminders: [
          {
            id: 'r-1',
            eventId: 'e-new',
            offsetMin: 15,
            channel: 'telegram',
            userId: null,
            sentAt: null,
            createdAt: new Date(),
          },
          {
            id: 'r-2',
            eventId: 'e-new',
            offsetMin: 1440,
            channel: 'telegram',
            userId: null,
            sentAt: null,
            createdAt: new Date(),
          },
        ],
      });
      txEventCreate.mockResolvedValue({ id: 'e-new' });
      txEventFindUnique.mockResolvedValue(created);
      // P1: MeetingsService.createForCalendarEvent → eventUpdate (relatedMeetingId + metadata).
      eventUpdate.mockResolvedValue({
        ...created,
        relatedMeetingId: 'm-1',
        metadata: { joinUrl: 'https://app/m/m-1' },
      });

      const dto = await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Daily standup',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T11:00:00Z'),
          kind: 'meeting',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: false,
        },
      });

      expect(entityFindOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't-1', type: 'event' }),
      );
      expect(txReminderCreateMany).toHaveBeenCalledOnce();
      const reminderArgs = txReminderCreateMany.mock.calls[0]![0] as {
        data: Array<{ offsetMin: number; channel: string }>;
      };
      expect(reminderArgs.data).toHaveLength(2);
      expect(
        reminderArgs.data.map((r) => r.offsetMin).sort((a, b) => a - b),
      ).toEqual([15, 1440]);
      expect(emitMock).toHaveBeenCalledWith(
        'event.created',
        expect.objectContaining({ tenantId: 't-1' }),
      );
      expect(incCreated).toHaveBeenCalledWith({
        tenant: 't-1',
        kind: 'meeting',
        visibility: 'company',
      });
      expect(dto.id).toBe('e-new');
    });

    it('для visibility=personal не эмитит event.created', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-p' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-p', visibility: 'personal', kind: 'personal_block' }),
      );

      await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Личное время',
          startAt: new Date('2026-06-01T15:00:00Z'),
          endAt: new Date('2026-06-01T16:00:00Z'),
          kind: 'personal_block',
          visibility: 'personal',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: false,
        },
      });

      expect(emitMock).not.toHaveBeenCalledWith('event.created', expect.anything());
    });
  });

  describe('update', () => {
    it('owner может обновить', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-1', ownerId: 'u-owner', participants: [] }),
      );
      eventUpdate.mockResolvedValue(
        makeEvent({ id: 'e-1', title: 'Updated', participants: [], reminders: [] }),
      );

      const dto = await svc.update({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-owner',
        data: { title: 'Updated' },
      });
      expect(dto.title).toBe('Updated');
      expect(eventUpdate).toHaveBeenCalledOnce();
    });

    it('чужой не может обновить (ForbiddenException)', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({ ownerId: 'u-other', participants: [] }),
      );
      await expect(
        svc.update({
          tenantId: 't-1',
          eventId: 'e-1',
          actorUserId: 'u-stranger',
          data: { title: 'Hijack' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('organizer (через EventParticipant) может обновить', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({
          ownerId: 'u-other',
          participants: [
            {
              id: 'p-1',
              userId: 'u-org',
              personId: null,
              role: 'organizer',
              rsvp: 'accepted',
              rsvpAt: null,
            },
          ],
        }),
      );
      eventUpdate.mockResolvedValue(
        makeEvent({ title: 'X', participants: [], reminders: [] }),
      );
      await expect(
        svc.update({
          tenantId: 't-1',
          eventId: 'e-1',
          actorUserId: 'u-org',
          data: { title: 'X' },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('softDelete', () => {
    it('помечает deletedAt + status=cancelled', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({ ownerId: 'u-owner', participants: [] }),
      );
      eventUpdate.mockResolvedValue({});
      await svc.softDelete({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-owner',
      });
      const updateCall = eventUpdate.mock.calls[0]![0] as {
        data: { deletedAt: Date; status: string };
      };
      expect(updateCall.data.status).toBe('cancelled');
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    });

    it('NotFoundException на несуществующее', async () => {
      eventFindUnique.mockResolvedValue(null);
      await expect(
        svc.softDelete({
          tenantId: 't-1',
          eventId: 'no-such',
          actorUserId: 'u-owner',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rsvp', () => {
    it('обновляет EventParticipant.rsvp', async () => {
      eventFindUnique.mockResolvedValue(makeEvent());
      participantFindFirst.mockResolvedValue({
        id: 'p-42',
        userId: 'u-me',
        personId: null,
        role: 'required',
        rsvp: 'pending',
        rsvpAt: null,
      });
      participantUpdate.mockResolvedValue({
        id: 'p-42',
        userId: 'u-me',
        personId: null,
        role: 'required',
        rsvp: 'accepted',
        rsvpAt: new Date(),
      });
      const r = await svc.rsvp({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-me',
        payload: { status: 'accepted' },
      });
      expect(r.rsvp).toBe('accepted');
    });

    it('non-participant → ForbiddenException', async () => {
      eventFindUnique.mockResolvedValue(makeEvent());
      participantFindFirst.mockResolvedValue(null);
      await expect(
        svc.rsvp({
          tenantId: 't-1',
          eventId: 'e-1',
          actorUserId: 'u-rando',
          payload: { status: 'accepted' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Calendar MVP Polish — P1 LiveKit integration', () => {
    it('create online:true (kind=meeting) → MeetingsService.createForCalendarEvent вызван; relatedMeetingId и joinUrl возвращаются', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-1' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-1', kind: 'meeting', online: true }),
      );
      eventUpdate.mockResolvedValue(
        makeEvent({
          id: 'e-1',
          kind: 'meeting',
          online: true,
          relatedMeetingId: 'm-42',
          metadata: { joinUrl: 'https://app/m/m-42' },
        }),
      );
      meetingsCreateForCalendarEvent.mockResolvedValue({
        meetingId: 'm-42',
        joinUrl: 'https://app/m/m-42',
      });

      const dto = await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Созвон по релизу',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T11:00:00Z'),
          kind: 'meeting',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: true,
        },
      });

      expect(meetingsCreateForCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't-1',
          ownerUserId: 'u-owner',
          title: 'Созвон по релизу',
          eventId: 'e-1',
        }),
      );
      expect(dto.relatedMeetingId).toBe('m-42');
      expect(dto.joinUrl).toBe('https://app/m/m-42');
    });

    it('create with kind=call (online:false) → MeetingsService НЕ вызывается (телефонный звонок)', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-call' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-call', kind: 'call' }),
      );

      const dto = await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Звонок клиенту',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T10:30:00Z'),
          kind: 'call',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: false,
        },
      });

      expect(meetingsCreateForCalendarEvent).not.toHaveBeenCalled();
      expect(dto.joinUrl).toBeNull();
      expect(dto.relatedMeetingId).toBeNull();
    });

    it('softDelete event с relatedMeetingId → MeetingsService.cancelScheduledForCalendarEvent вызван', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({
          ownerId: 'u-owner',
          participants: [],
          relatedMeetingId: 'm-99',
        }),
      );
      eventUpdate.mockResolvedValue({});

      await svc.softDelete({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-owner',
      });

      expect(meetingsCancelScheduled).toHaveBeenCalledWith({
        meetingId: 'm-99',
        reason: 'event_deleted',
      });
    });

    it('softDelete event без relatedMeetingId → MeetingsService не дёргается', async () => {
      eventFindUnique.mockResolvedValue(
        makeEvent({
          ownerId: 'u-owner',
          participants: [],
          relatedMeetingId: null,
        }),
      );
      eventUpdate.mockResolvedValue({});

      await svc.softDelete({
        tenantId: 't-1',
        eventId: 'e-2',
        actorUserId: 'u-owner',
      });

      expect(meetingsCancelScheduled).not.toHaveBeenCalled();
    });
  });

  describe('Ф6/Ф5 — формат online (видеокомната) и контрагент (counterparty)', () => {
    it('create с online:true → createForCalendarEvent вызван 1 раз', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-on' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-on', kind: 'meeting', online: true }),
      );
      eventUpdate.mockResolvedValue(
        makeEvent({
          id: 'e-on',
          kind: 'meeting',
          online: true,
          relatedMeetingId: 'm-1',
          metadata: { joinUrl: 'https://app/m/m-1' },
        }),
      );

      await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Онлайн-созвон',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T11:00:00Z'),
          kind: 'meeting',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: true,
        },
      });

      expect(meetingsCreateForCalendarEvent).toHaveBeenCalledTimes(1);
      expect(meetingsCreateForCalendarEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't-1',
          ownerUserId: 'u-owner',
          title: 'Онлайн-созвон',
          eventId: 'e-on',
        }),
      );
    });

    it('create с online:false, kind:meeting → createForCalendarEvent НЕ вызван (ключевой фикс)', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-off' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-off', kind: 'meeting', online: false }),
      );

      const dto = await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Очное совещание',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T11:00:00Z'),
          kind: 'meeting',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: false,
        },
      });

      expect(meetingsCreateForCalendarEvent).not.toHaveBeenCalled();
      expect(dto.online).toBe(false);
      expect(dto.relatedMeetingId).toBeNull();
    });

    it('create с counterparty и без location → в event.create data counterparty строка, location null', async () => {
      txEventCreate.mockResolvedValue({ id: 'e-cp' });
      txEventFindUnique.mockResolvedValue(
        makeEvent({ id: 'e-cp', counterparty: 'Александр, молочный завод' }),
      );

      await svc.create({
        tenantId: 't-1',
        ownerId: 'u-owner',
        data: {
          title: 'Встреча по поставке',
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T11:00:00Z'),
          kind: 'meeting',
          visibility: 'company',
          allDay: false,
          timezone: 'Europe/Moscow',
          online: false,
          counterparty: 'Александр, молочный завод',
          location: undefined,
        },
      });

      const createArgs = txEventCreate.mock.calls[0]![0] as {
        data: { counterparty: string | null; location: string | null };
      };
      expect(createArgs.data.counterparty).toBe('Александр, молочный завод');
      expect(createArgs.data.location).toBeNull();
    });

    it('makeEventOnline на офлайн-событии → online ставится, createForCalendarEvent вызван; повторно на online+room → НЕ вызван (идемпотентность)', async () => {
      // Офлайн-событие: online:false, relatedMeetingId:null.
      eventFindUnique
        .mockResolvedValueOnce(
          makeEvent({ id: 'e-1', online: false, relatedMeetingId: null }),
        )
        // Финальный re-fetch после attachLivekitRoom.
        .mockResolvedValueOnce(
          makeEvent({ id: 'e-1', online: true, relatedMeetingId: 'm-1' }),
        );
      eventUpdate
        // update online:true.
        .mockResolvedValueOnce(
          makeEvent({ id: 'e-1', online: true, relatedMeetingId: null }),
        )
        // attachLivekitRoom → event.update (relatedMeetingId + metadata).
        .mockResolvedValueOnce(
          makeEvent({
            id: 'e-1',
            online: true,
            relatedMeetingId: 'm-1',
            metadata: { joinUrl: 'https://app/m/m-1' },
          }),
        );

      const dto = await svc.makeEventOnline({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-owner',
      });
      expect(meetingsCreateForCalendarEvent).toHaveBeenCalledTimes(1);
      expect(dto.online).toBe(true);
      expect(dto.relatedMeetingId).toBe('m-1');

      // Идемпотентность: уже online + есть комната → ничего не делаем.
      meetingsCreateForCalendarEvent.mockClear();
      eventFindUnique.mockResolvedValueOnce(
        makeEvent({ id: 'e-1', online: true, relatedMeetingId: 'x' }),
      );
      await svc.makeEventOnline({
        tenantId: 't-1',
        eventId: 'e-1',
        actorUserId: 'u-owner',
      });
      expect(meetingsCreateForCalendarEvent).not.toHaveBeenCalled();
    });
  });

  describe('Calendar MVP Polish — P3 projectId filter', () => {
    it('getMyCalendar с projectId → where.projectId включён в SQL', async () => {
      eventFindMany.mockResolvedValue([]);
      issueFindMany.mockResolvedValue([]);

      await svc.getMyCalendar({
        tenantId: 't-1',
        userId: 'u-me',
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-06-02T00:00:00Z'),
        projectId: 'prj-7',
      });

      expect(eventFindMany).toHaveBeenCalledOnce();
      const eventArgs = eventFindMany.mock.calls[0]![0] as {
        where: { projectId?: string };
      };
      expect(eventArgs.where.projectId).toBe('prj-7');

      expect(issueFindMany).toHaveBeenCalledOnce();
      const issueArgs = issueFindMany.mock.calls[0]![0] as {
        where: { projectId?: string };
      };
      expect(issueArgs.where.projectId).toBe('prj-7');
    });

    it('getMyCalendar без projectId → where.projectId не присутствует', async () => {
      eventFindMany.mockResolvedValue([]);
      issueFindMany.mockResolvedValue([]);

      await svc.getMyCalendar({
        tenantId: 't-1',
        userId: 'u-me',
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-06-02T00:00:00Z'),
      });

      const eventArgs = eventFindMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(eventArgs.where.projectId).toBeUndefined();
    });
  });

  describe('Ф3 — дефолтное окно «сегодня» в таймзоне человека', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('getMyCalendar без from/to: окно = локальные сутки UTC+7 (Asia/Novosibirsk)', async () => {
      // Фиксируем «сейчас» = 2026-06-18 09:30 UTC = 16:30 чт в Новосибирске.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-18T09:30:00.000Z'));
      // У человека TZ Новосибирск.
      personFindFirst.mockResolvedValue({ timezone: 'Asia/Novosibirsk' });
      eventFindMany.mockResolvedValue([]);
      issueFindMany.mockResolvedValue([]);

      await svc.getMyCalendar({ tenantId: 't-1', userId: 'u-me' });

      expect(eventFindMany).toHaveBeenCalledOnce();
      const where = (
        eventFindMany.mock.calls[0]![0] as {
          where: { startAt: { gte: Date; lt: Date } };
        }
      ).where;
      // 00:00 18-го новосиб. = 2026-06-17T17:00:00Z; +24ч.
      expect(where.startAt.gte.toISOString()).toBe('2026-06-17T17:00:00.000Z');
      expect(where.startAt.lt.toISOString()).toBe('2026-06-18T17:00:00.000Z');
    });

    it('профиль без TZ → fallback Moscow (UTC+3): 00:00 = 2026-06-17T21:00:00Z', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-18T09:30:00.000Z'));
      personFindFirst.mockResolvedValue(null);
      membershipFindFirst.mockResolvedValue(null);
      eventFindMany.mockResolvedValue([]);
      issueFindMany.mockResolvedValue([]);

      await svc.getMyCalendar({ tenantId: 't-1', userId: 'u-me' });

      const where = (
        eventFindMany.mock.calls[0]![0] as {
          where: { startAt: { gte: Date; lt: Date } };
        }
      ).where;
      expect(where.startAt.gte.toISOString()).toBe('2026-06-17T21:00:00.000Z');
      expect(where.startAt.lt.toISOString()).toBe('2026-06-18T21:00:00.000Z');
    });
  });

  describe('getUserCalendar — visibility masking', () => {
    it('personal-события чужого user возвращаются как «Занято» без деталей', async () => {
      eventFindMany.mockResolvedValue([
        makeEvent({
          id: 'e-personal',
          visibility: 'personal',
          title: 'Тайное',
          location: 'Дом',
          description: 'секрет',
        }),
      ]);
      issueFindMany.mockResolvedValue([]);

      const r = await svc.getUserCalendar({
        tenantId: 't-1',
        currentUserId: 'u-me',
        targetUserId: 'u-other',
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-06-02T00:00:00Z'),
      });
      expect(r.items).toHaveLength(1);
      const item = r.items[0]!;
      expect(item.type).toBe('event');
      if (item.type === 'event') {
        expect(item.event.title).toBe('Занято');
        expect(item.event.location).toBeNull();
        expect(item.event.description).toBeNull();
      }
    });

    it('собственный календарь — personal видны полностью', async () => {
      eventFindMany.mockResolvedValue([
        makeEvent({
          id: 'e-personal',
          visibility: 'personal',
          title: 'Личное время',
        }),
      ]);
      issueFindMany.mockResolvedValue([]);
      const r = await svc.getUserCalendar({
        tenantId: 't-1',
        currentUserId: 'u-me',
        targetUserId: 'u-me',
        from: new Date('2026-06-01T00:00:00Z'),
        to: new Date('2026-06-02T00:00:00Z'),
      });
      expect(r.items[0]!.type).toBe('event');
      const it = r.items[0]!;
      if (it.type === 'event') {
        expect(it.event.title).toBe('Личное время');
      }
    });
  });
});
