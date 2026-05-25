import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  CreateEventSchema,
  type CreateEventDto,
  type CalendarResponseDto,
  type EventDto,
  type FindFreeSlotDto,
  type FindFreeSlotResponse,
  FindFreeSlotSchema,
  type ListEventsQuery,
  ListEventsQuerySchema,
  type ListEventsResponse,
  type MyCalendarQuery,
  MyCalendarQuerySchema,
  type RsvpDto,
  RsvpSchema,
  type UpdateEventDto,
  UpdateEventSchema,
  type EventParticipantDto,
} from './dto/events.dto';
import { EventsService } from './services/events.service';
import { FindFreeSlotService } from './services/find-free-slot.service';

/**
 * REST API событий графа знаний + Calendar MVP (2026-05-25).
 *
 * Чтение (Org-scope):
 *   GET    /api/v1/events                — list (фильтры kind/from/to/q)
 *   GET    /api/v1/events/:id            — by id
 *
 * Запись (Calendar MVP):
 *   POST   /api/v1/events                — create
 *   PATCH  /api/v1/events/:id            — partial update
 *   DELETE /api/v1/events/:id            — soft delete
 *   POST   /api/v1/events/:id/rsvp       — RSVP участника
 *   POST   /api/v1/events/find-free-slot — поиск общего слота
 *
 * Календарь:
 *   GET    /api/v1/me/calendar           — мой календарь
 *   GET    /api/v1/users/:userId/calendar — чужой календарь
 *
 * RBAC: ресурс `event_card` — owner/admin: read/write/delete; manager: read.
 * Plus app-level checks: для update/delete — owner OR organizer.
 */
@ApiTags('events')
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(FindFreeSlotService)
    private readonly freeSlot: FindFreeSlotService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── reads ───────────────────────────────────

  @Get('events')
  @ApiOperation({ summary: 'Список событий Org (с фильтрами по kind/from/to)' })
  async list(
    @Query(new ZodValidationPipe(ListEventsQuerySchema)) q: ListEventsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListEventsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.events.list({ tenantId: t, query: q });
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Получить событие по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EventDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.events.getById({ tenantId: t, id });
  }

  // ─────────────────────────── writes (Calendar MVP) ───────────────────

  @Post('events')
  @ApiOperation({
    summary: 'Создать событие календаря (встреча, созвон, блок времени)',
  })
  async create(
    @Body(new ZodValidationPipe(CreateEventSchema)) body: CreateEventDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EventDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.events.create({
      tenantId: t,
      ownerId: user.id,
      data: body,
    });
  }

  @Patch('events/:id')
  @ApiOperation({ summary: 'Обновить событие (только owner/organizer)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEventSchema)) body: UpdateEventDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EventDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.events.update({
      tenantId: t,
      eventId: id,
      actorUserId: user.id,
      data: body,
    });
  }

  @Delete('events/:id')
  @ApiOperation({
    summary: 'Отменить событие (soft delete, только owner/organizer)',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    await this.events.softDelete({
      tenantId: t,
      eventId: id,
      actorUserId: user.id,
    });
    return { ok: true };
  }

  @Post('events/:id/rsvp')
  @ApiOperation({ summary: 'RSVP участника события' })
  async rsvp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RsvpSchema)) body: RsvpDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EventParticipantDto> {
    const t = this.requireTenant(tenantId);
    return this.events.rsvp({
      tenantId: t,
      eventId: id,
      actorUserId: user.id,
      payload: body,
    });
  }

  @Post('events/find-free-slot')
  @ApiOperation({
    summary: 'Найти ближайший общий свободный слот среди участников',
  })
  async findFreeSlot(
    @Body(new ZodValidationPipe(FindFreeSlotSchema)) body: FindFreeSlotDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<FindFreeSlotResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.freeSlot.findFreeSlot({
      tenantId: t,
      participantUserIds: body.participantUserIds,
      durationMin: body.durationMin,
      withinDays: body.withinDays,
      workingHoursOnly: body.workingHoursOnly,
    });
  }

  // ─────────────────────────── calendar ────────────────────────────────

  @Get('me/calendar')
  @ApiOperation({
    summary:
      'Мой календарь (события + дедлайны задач). Опц. ?projectId= — фильтр по проекту (P3).',
  })
  async myCalendar(
    @Query(new ZodValidationPipe(MyCalendarQuerySchema)) q: MyCalendarQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CalendarResponseDto> {
    const t = this.requireTenant(tenantId);
    return this.events.getMyCalendar({
      tenantId: t,
      userId: user.id,
      from: q.from,
      to: q.to,
      ...(q.projectId ? { projectId: q.projectId } : {}),
    });
  }

  // ─────────────────────────── ICS-feed token ──────────────────────────

  /**
   * Сгенерировать персональную ссылку на ICS-feed. Если токен уже есть —
   * возвращает существующую ссылку (не перевыпускаем без явного `DELETE`).
   * Адрес фида: `{publicHostUrl}/api/v1/calendar/{userId}.ics?token={token}`.
   */
  @Post('me/calendar/feed/generate')
  @ApiOperation({
    summary: 'Сгенерировать ссылку на ICS-подписку моего календаря',
  })
  async generateCalendarFeedToken(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ url: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { calendarFeedToken: true },
    });
    let token = existing?.calendarFeedToken ?? null;
    if (!token) {
      token = randomBytes(32).toString('base64url');
      await this.prisma.user.update({
        where: { id: user.id },
        data: { calendarFeedToken: token },
      });
    }
    const base = this.cfg.publicHostUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/calendar/${user.id}.ics?token=${token}`;
    return { url };
  }

  /**
   * Удалить токен ICS-подписки (для перевыпуска). После этого старая ссылка
   * перестаёт работать; новая получается через `POST /me/calendar/feed/generate`.
   */
  @Delete('me/calendar/feed')
  @ApiOperation({
    summary: 'Удалить токен ICS-подписки (для перевыпуска ссылки)',
  })
  async revokeCalendarFeedToken(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { calendarFeedToken: null },
    });
    return { ok: true };
  }

  @Get('users/:userId/calendar')
  @ApiOperation({
    summary:
      'Календарь другого пользователя (нужны права event_card.read; personal-события маскируются)',
  })
  async userCalendar(
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(MyCalendarQuerySchema)) q: MyCalendarQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CalendarResponseDto> {
    const t = this.requireTenant(tenantId);
    if (user.id !== userId) {
      // RBAC чек: read события чужого пользователя.
      await this.requireRead(user.id, t);
    }
    return this.events.getUserCalendar({
      tenantId: t,
      currentUserId: user.id,
      targetUserId: userId,
      from: q.from,
      to: q.to,
      ...(q.projectId ? { projectId: q.projectId } : {}),
    });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'event_card');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения событий',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'event_card');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для изменения событий',
        },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'event_card',
      act: 'delete',
      resourceOwnerId: null,
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для удаления событий',
        },
      });
    }
  }
}
