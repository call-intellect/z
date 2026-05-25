import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type Event,
  type EventParticipant,
  type EventParticipantRole,
  type EventReminder,
  type Issue,
  Prisma,
  type Project,
  type RsvpStatus,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import type {
  CalendarItemDto,
  CalendarResponseDto,
  CreateEventDto,
  EventDto,
  EventKindDto,
  EventListItemDto,
  EventParticipantDto,
  EventReminderDto,
  EventStatusDto,
  EventVisibilityDto,
  ListEventsQuery,
  ListEventsResponse,
  RsvpDto,
  UpdateEventDto,
} from '../dto/events.dto';

/**
 * EventsService — управление событиями графа знаний + календарём пользователя
 * (Calendar MVP 2026-05-25).
 *
 * CRUD-операции:
 *   - `create` — Entity{type=event} + Event + participants + reminders +
 *     (если kind=meeting → TODO интеграция с MeetingsService).
 *   - `update` / `softDelete` — права на основе owner/organizer.
 *   - `rsvp` — обновление статуса участника.
 *
 * Календарь:
 *   - `getMyCalendar` — собственные события + назначенные задачи.
 *   - `getUserCalendar` — события другого user (personal маскируются «Занято»).
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityResolutionService)
    private readonly entityResolver: EntityResolutionService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional() @Inject(EventEmitter2) private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ─────────────────────────── read API (read-only, legacy α-3) ────────

  async list(args: {
    tenantId: string;
    query: ListEventsQuery;
  }): Promise<ListEventsResponse> {
    const { tenantId, query } = args;
    const where: Prisma.EventWhereInput = { tenantId };

    if (!query.includeDeleted) where.deletedAt = null;
    if (query.kind) where.kind = query.kind;
    if (query.from || query.to) {
      where.startAt = {};
      if (query.from) where.startAt.gte = query.from;
      if (query.to) where.startAt.lte = query.to;
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { location: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: [{ startAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      items: items.map((e) => this.toListItem(e)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<EventDto> {
    const e = await this.prisma.event.findUnique({
      where: { id: args.id },
      include: { participants: true, reminders: true },
    });
    if (!e || e.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'event_not_found', message: 'Событие не найдено' },
      });
    }
    return this.toDetail(e);
  }

  // ─────────────────────────── CRUD (Calendar MVP) ─────────────────────

  /**
   * Создание события. Шаги:
   *   1. Резолвим/создаём Entity{type=event} (через EntityResolutionService).
   *   2. Создаём Event + EventParticipant'ы (включая organizer = ownerId).
   *   3. Если reminders не переданы — для kind ∈ {meeting,call,offline_meeting}
   *      создаём дефолтные: за 15 мин + за 1 день, channel='telegram', всем.
   *   4. TODO: kind=meeting → MeetingsService.create + Event.relatedMeetingId.
   *   5. Если visibility != personal — emit('event.created') для будущей
   *      интеграции в knowledge-core RawEvent.
   */
  async create(args: {
    tenantId: string;
    ownerId: string;
    data: CreateEventDto;
  }): Promise<EventDto> {
    const { tenantId, ownerId, data } = args;

    // 1. Entity{type=event}.
    const { entity } = await this.entityResolver.findOrCreateEntity({
      tenantId,
      type: 'event',
      name: data.title.trim(),
      metadata: { source: 'calendar_user', kind: data.kind },
    });

    // 2. Транзакция: Event + participants + reminders.
    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          tenantId,
          entityId: entity.id,
          ownerId,
          kind: data.kind,
          title: data.title.trim().slice(0, 300),
          startAt: data.startAt,
          endAt: data.endAt ?? null,
          durationMin:
            data.endAt !== undefined
              ? Math.max(
                  0,
                  Math.round((data.endAt.getTime() - data.startAt.getTime()) / 60_000),
                )
              : null,
          description: data.description ?? null,
          location: data.location?.trim() ?? null,
          allDay: data.allDay,
          timezone: data.timezone,
          rrule: data.rrule ?? null,
          visibility: data.visibility,
          projectId: data.projectId ?? null,
        },
      });

      // Organizer всегда — owner.
      const participantRows: Prisma.EventParticipantCreateManyInput[] = [
        {
          eventId: event.id,
          userId: ownerId,
          role: 'organizer',
          rsvp: 'accepted',
          rsvpAt: new Date(),
        },
      ];
      if (data.participants?.length) {
        for (const p of data.participants) {
          // Не дублируем owner'а, если он в participants.
          if (p.userId === ownerId) continue;
          const role: EventParticipantRole = p.optional ? 'optional' : p.role;
          participantRows.push({
            eventId: event.id,
            userId: p.userId ?? null,
            personId: p.personId ?? null,
            role,
          });
        }
      }
      if (participantRows.length > 0) {
        await tx.eventParticipant.createMany({ data: participantRows });
      }

      // Reminders: переданные либо дефолтные.
      const reminderRows: Prisma.EventReminderCreateManyInput[] = [];
      if (data.reminders?.length) {
        for (const r of data.reminders) {
          reminderRows.push({
            eventId: event.id,
            offsetMin: r.offsetMin,
            channel: r.channel,
            userId: r.userId ?? null,
          });
        }
      } else if (
        data.kind === 'meeting' ||
        data.kind === 'call' ||
        data.kind === 'offline_meeting'
      ) {
        // Дефолтные: за 15 минут + за 1 день. Канал telegram, всем участникам.
        reminderRows.push(
          {
            eventId: event.id,
            offsetMin: 15,
            channel: 'telegram',
            userId: null,
          },
          {
            eventId: event.id,
            offsetMin: 24 * 60,
            channel: 'telegram',
            userId: null,
          },
        );
      }
      if (reminderRows.length > 0) {
        await tx.eventReminder.createMany({ data: reminderRows });
      }

      // Re-fetch со связями для DTO.
      const full = await tx.event.findUnique({
        where: { id: event.id },
        include: { participants: true, reminders: true },
      });
      return full!;
    });

    // 3. TODO: kind=meeting → создать LiveKit Meeting через MeetingsService
    // и записать meeting.id в Event.relatedMeetingId. Текущий
    // MeetingsService.createForUser требует partner-контекст, не подходит
    // под календарь напрямую. Откладываем до доработки MeetingsService.create.
    if (data.kind === 'meeting') {
      this.logger.warn(
        { eventId: created.id, kind: data.kind },
        'TODO: создание LiveKit Meeting для kind=meeting — пока заглушка',
      );
    }

    // 4. Доменное событие (для будущей RawEvent-интеграции в knowledge-core).
    if (data.visibility !== 'personal') {
      this.tryEmit('event.created', {
        tenantId,
        eventId: created.id,
        kind: data.kind,
        ownerId,
      });
    }

    // 5. Метрика.
    this.metrics.incCalendarEventCreated({
      tenant: tenantId,
      kind: data.kind,
      visibility: data.visibility,
    });

    return this.toDetail(created);
  }

  /**
   * Обновление. Только owner или organizer (EventParticipant.role='organizer')
   * могут менять; RBAC-проверка `event_card.write` уже сделана в controller'е.
   */
  async update(args: {
    tenantId: string;
    eventId: string;
    actorUserId: string;
    data: UpdateEventDto;
  }): Promise<EventDto> {
    const { tenantId, eventId, actorUserId, data } = args;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });
    if (!event || event.tenantId !== tenantId || event.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'event_not_found', message: 'Событие не найдено' },
      });
    }
    await this.assertOwnerOrOrganizer({ event, actorUserId });

    const patch: Prisma.EventUpdateInput = {};
    if (data.title !== undefined) patch.title = data.title.trim().slice(0, 300);
    if (data.startAt !== undefined) patch.startAt = data.startAt;
    if (data.endAt !== undefined) patch.endAt = data.endAt;
    if (data.kind !== undefined) patch.kind = data.kind;
    if (data.visibility !== undefined) patch.visibility = data.visibility;
    if (data.description !== undefined) patch.description = data.description;
    if (data.location !== undefined)
      patch.location = data.location?.trim() ?? null;
    if (data.allDay !== undefined) patch.allDay = data.allDay;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.rrule !== undefined) patch.rrule = data.rrule;
    if (data.status !== undefined) patch.status = data.status;
    if (data.projectId !== undefined) patch.projectId = data.projectId;

    const newStart =
      data.startAt !== undefined ? data.startAt : event.startAt;
    const newEnd =
      data.endAt !== undefined ? data.endAt : event.endAt;
    if (newStart && newEnd) {
      patch.durationMin = Math.max(
        0,
        Math.round((newEnd.getTime() - newStart.getTime()) / 60_000),
      );
    } else if (data.endAt === null) {
      patch.durationMin = null;
    }

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: patch,
      include: { participants: true, reminders: true },
    });

    this.tryEmit('event.updated', {
      tenantId,
      eventId: updated.id,
      ownerId: updated.ownerId,
    });

    return this.toDetail(updated);
  }

  /**
   * Soft delete: deletedAt=now, status=cancelled. Связанный Meeting (если
   * есть) тоже отменяется (TODO: вызов MeetingsService.cancelScheduled).
   */
  async softDelete(args: {
    tenantId: string;
    eventId: string;
    actorUserId: string;
  }): Promise<void> {
    const { tenantId, eventId, actorUserId } = args;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });
    if (!event || event.tenantId !== tenantId || event.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'event_not_found', message: 'Событие не найдено' },
      });
    }
    await this.assertOwnerOrOrganizer({ event, actorUserId });

    await this.prisma.event.update({
      where: { id: eventId },
      data: { deletedAt: new Date(), status: 'cancelled' },
    });

    if (event.relatedMeetingId) {
      // TODO: интеграция с MeetingsService.cancelScheduled —
      // нужен partnerId, у нас нет. Когда появится универсальный cancel —
      // вызвать его здесь.
      this.logger.warn(
        { eventId, meetingId: event.relatedMeetingId },
        'TODO: отмена LiveKit Meeting при soft-delete события — пока no-op',
      );
    }

    this.tryEmit('event.deleted', { tenantId, eventId });
  }

  /**
   * RSVP участника. Пользователь должен иметь EventParticipant.userId =
   * actorUserId (не organizer, любая роль). Идемпотентно перезаписывает.
   */
  async rsvp(args: {
    tenantId: string;
    eventId: string;
    actorUserId: string;
    payload: RsvpDto;
  }): Promise<EventParticipantDto> {
    const { tenantId, eventId, actorUserId, payload } = args;
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event || event.tenantId !== tenantId || event.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'event_not_found', message: 'Событие не найдено' },
      });
    }

    const participant = await this.prisma.eventParticipant.findFirst({
      where: { eventId, userId: actorUserId },
    });
    if (!participant) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_a_participant',
          message: 'Вы не являетесь участником этого события',
        },
      });
    }

    const updated = await this.prisma.eventParticipant.update({
      where: { id: participant.id },
      data: {
        rsvp: payload.status as RsvpStatus,
        rsvpAt: new Date(),
      },
    });

    this.tryEmit('event.rsvp_changed', {
      tenantId,
      eventId,
      userId: actorUserId,
      status: payload.status,
    });

    return this.participantToDto(updated);
  }

  // ─────────────────────────── /me/calendar ────────────────────────────

  async getMyCalendar(args: {
    tenantId: string;
    userId: string;
    from?: Date;
    to?: Date;
  }): Promise<CalendarResponseDto> {
    const { tenantId, userId } = args;
    const { from, to } = this.resolveCalendarWindow(args.from, args.to);

    const [events, issues] = await Promise.all([
      this.fetchEventsForUser({ tenantId, userId, from, to, includePersonal: true }),
      this.fetchIssuesForUser({ tenantId, userId, from, to }),
    ]);

    const items: CalendarItemDto[] = [
      ...events.map((e) => this.toCalendarEventItem(e, /*mask*/ false)),
      ...issues.map((i) => this.toCalendarIssueItem(i)),
    ];

    items.sort((a, b) => {
      const ta =
        a.type === 'event' ? a.event.startAt : a.issue.dueDate;
      const tb =
        b.type === 'event' ? b.event.startAt : b.issue.dueDate;
      return ta.localeCompare(tb);
    });
    return { items };
  }

  /**
   * Календарь другого пользователя. Если targetUserId === currentUserId —
   * то же, что getMyCalendar. Иначе personal-события возвращаются с маской
   * «Занято» (показывает занятость без деталей).
   */
  async getUserCalendar(args: {
    tenantId: string;
    currentUserId: string;
    targetUserId: string;
    from?: Date;
    to?: Date;
  }): Promise<CalendarResponseDto> {
    const { tenantId, currentUserId, targetUserId } = args;
    if (currentUserId === targetUserId) {
      return this.getMyCalendar({
        tenantId,
        userId: targetUserId,
        from: args.from,
        to: args.to,
      });
    }
    const { from, to } = this.resolveCalendarWindow(args.from, args.to);
    const [events, issues] = await Promise.all([
      this.fetchEventsForUser({
        tenantId,
        userId: targetUserId,
        from,
        to,
        includePersonal: true, // подгружаем, но ниже замаскируем
      }),
      this.fetchIssuesForUser({ tenantId, userId: targetUserId, from, to }),
    ]);

    const items: CalendarItemDto[] = [
      ...events.map((e) =>
        this.toCalendarEventItem(e, /*mask*/ e.visibility === 'personal'),
      ),
      ...issues.map((i) => this.toCalendarIssueItem(i)),
    ];
    items.sort((a, b) => {
      const ta = a.type === 'event' ? a.event.startAt : a.issue.dueDate;
      const tb = b.type === 'event' ? b.event.startAt : b.issue.dueDate;
      return ta.localeCompare(tb);
    });
    return { items };
  }

  // ─────────────────────────── helpers (private) ───────────────────────

  /**
   * Возвращает сырые Event'ы и Issue'ы пользователя в окне [from, to] —
   * для генерации ICS-feed (`/api/v1/calendar/:userId.ics`). В отличие от
   * `getMyCalendar`, здесь не нужен tenant — feed строится по конкретному
   * user'у (его tenant вычисляется отдельно или не учитывается, т.к. token
   * привязан к user'у). Включает personal-события (это собственный feed
   * пользователя).
   */
  async getEventsForFeed(args: {
    userId: string;
    from: Date;
    to: Date;
  }): Promise<{
    events: (Event & {
      participants: EventParticipant[];
      reminders: EventReminder[];
    })[];
    issues: (Issue & { project: Project | null })[];
  }> {
    const { userId, from, to } = args;
    const [events, issues] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          deletedAt: null,
          startAt: { gte: from, lt: to },
          OR: [
            { ownerId: userId },
            { participants: { some: { userId } } },
          ],
        },
        include: { participants: true, reminders: true },
        orderBy: [{ startAt: 'asc' }],
      }),
      this.prisma.issue.findMany({
        where: {
          deletedAt: null,
          dueDate: { gte: from, lt: to },
          assignees: { some: { userId } },
        },
        include: { project: true },
        orderBy: [{ dueDate: 'asc' }],
      }),
    ]);
    return { events, issues };
  }

  /**
   * Внутренний метод для FindFreeSlotService — возвращает busy-окна для
   * заданного пользователя (Events + Issues с dueDate).
   */
  async fetchBusyWindowsForUser(args: {
    tenantId: string;
    userId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ start: Date; end: Date }>> {
    const [events, issues] = await Promise.all([
      this.fetchEventsForUser({
        tenantId: args.tenantId,
        userId: args.userId,
        from: args.from,
        to: args.to,
        includePersonal: true,
      }),
      this.fetchIssuesForUser({
        tenantId: args.tenantId,
        userId: args.userId,
        from: args.from,
        to: args.to,
      }),
    ]);
    const out: Array<{ start: Date; end: Date }> = [];
    for (const e of events) {
      const start = e.startAt;
      const end =
        e.endAt ??
        new Date(e.startAt.getTime() + Math.max(0, e.durationMin ?? 30) * 60_000);
      out.push({ start, end });
    }
    for (const i of issues) {
      if (!i.dueDate) continue;
      const start = i.dueDate;
      const end = new Date(start.getTime() + 30 * 60_000);
      out.push({ start, end });
    }
    return out;
  }

  private resolveCalendarWindow(
    from?: Date,
    to?: Date,
  ): { from: Date; to: Date } {
    if (from && to) return { from, to };
    const now = new Date();
    if (from && !to) {
      return { from, to: new Date(from.getTime() + 24 * 60 * 60_000) };
    }
    if (!from && to) {
      return { from: new Date(to.getTime() - 24 * 60 * 60_000), to };
    }
    // Default — сегодня 00:00 — завтра 00:00 (UTC).
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    return { from: start, to: end };
  }

  private async fetchEventsForUser(args: {
    tenantId: string;
    userId: string;
    from: Date;
    to: Date;
    includePersonal: boolean;
  }): Promise<
    (Event & { participants: EventParticipant[]; reminders: EventReminder[] })[]
  > {
    const { tenantId, userId, from, to } = args;
    return this.prisma.event.findMany({
      where: {
        tenantId,
        deletedAt: null,
        startAt: { gte: from, lt: to },
        OR: [
          { ownerId: userId },
          { participants: { some: { userId } } },
          { visibility: 'company' },
        ],
      },
      include: { participants: true, reminders: true },
      orderBy: [{ startAt: 'asc' }],
    });
  }

  private async fetchIssuesForUser(args: {
    tenantId: string;
    userId: string;
    from: Date;
    to: Date;
  }): Promise<(Issue & { project: Project | null })[]> {
    const { tenantId, userId, from, to } = args;
    return this.prisma.issue.findMany({
      where: {
        tenantId,
        deletedAt: null,
        dueDate: { gte: from, lt: to },
        assignees: { some: { userId } },
      },
      include: { project: true },
      orderBy: [{ dueDate: 'asc' }],
    });
  }

  private async assertOwnerOrOrganizer(args: {
    event: Event & { participants: EventParticipant[] };
    actorUserId: string;
  }): Promise<void> {
    const { event, actorUserId } = args;
    if (event.ownerId === actorUserId) return;
    const isOrganizer = event.participants.some(
      (p) => p.userId === actorUserId && p.role === 'organizer',
    );
    if (isOrganizer) return;
    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'not_owner_or_organizer',
        message: 'Только владелец или организатор может изменять событие',
      },
    });
  }

  private tryEmit(name: string, payload: Record<string, unknown>): void {
    try {
      this.eventEmitter?.emit(name, payload);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), name },
        'EventEmitter.emit failed — продолжаю',
      );
    }
  }

  // ─────────────────────────── mappers ─────────────────────────────────

  private toListItem(e: Event): EventListItemDto {
    return {
      id: e.id,
      entityId: e.entityId,
      kind: e.kind as EventKindDto,
      title: e.title,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt ? e.endAt.toISOString() : null,
      durationMin: e.durationMin,
      location: e.location,
      relatedMeetingId: e.relatedMeetingId,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    };
  }

  private toDetail(
    e: Event & {
      participants?: EventParticipant[];
      reminders?: EventReminder[];
    },
  ): EventDto {
    return {
      ...this.toListItem(e),
      participantsPersonIds: e.participantsPersonIds,
      outcomeSummary: e.outcomeSummary,
      metadata:
        e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)
          : null,
      ownerId: e.ownerId,
      description: e.description,
      allDay: e.allDay,
      timezone: e.timezone,
      rrule: e.rrule,
      status: e.status as EventStatusDto,
      visibility: e.visibility as EventVisibilityDto,
      externalProvider: e.externalProvider,
      externalEventId: e.externalEventId,
      projectId: e.projectId,
      participants: (e.participants ?? []).map((p) => this.participantToDto(p)),
      reminders: (e.reminders ?? []).map((r) => this.reminderToDto(r)),
    };
  }

  private participantToDto(p: EventParticipant): EventParticipantDto {
    return {
      id: p.id,
      userId: p.userId,
      personId: p.personId,
      role: p.role,
      rsvp: p.rsvp,
      rsvpAt: p.rsvpAt ? p.rsvpAt.toISOString() : null,
    };
  }

  private reminderToDto(r: EventReminder): EventReminderDto {
    return {
      id: r.id,
      offsetMin: r.offsetMin,
      channel: r.channel,
      userId: r.userId,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    };
  }

  private toCalendarEventItem(
    e: Event & { participants: EventParticipant[]; reminders: EventReminder[] },
    mask: boolean,
  ): CalendarItemDto {
    if (mask) {
      // Personal event чужого пользователя — отдаём только границы и заглушку.
      const masked: Event = {
        ...e,
        title: 'Занято',
        description: null,
        location: null,
        participantsPersonIds: [],
        metadata: null,
        outcomeSummary: null,
      };
      return {
        type: 'event',
        event: {
          ...this.toDetail({ ...masked, participants: [], reminders: [] }),
        },
      };
    }
    return { type: 'event', event: this.toDetail(e) };
  }

  private toCalendarIssueItem(
    i: Issue & { project: Project | null },
  ): CalendarItemDto {
    return {
      type: 'issue',
      issue: {
        id: i.id,
        title: i.title,
        dueDate: (i.dueDate ?? new Date(0)).toISOString(),
        projectId: i.projectId,
        projectName: i.project?.name ?? null,
        priority: i.priority,
        stateId: i.stateId,
      },
    };
  }
}
