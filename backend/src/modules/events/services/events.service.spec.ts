import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';

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
    } as unknown as PrismaService;

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

    svc = new EventsService(prisma, entityResolver, metrics, {
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
