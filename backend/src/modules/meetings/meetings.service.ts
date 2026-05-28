import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type AiResult,
  type Meeting,
  type MeetingStatus,
  type MeetingType,
  type Participant,
  type Recording,
  type Transcript,
} from '@prisma/client';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../common/config/index';
import {
  MeetingNotFoundError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';
import { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import { UsersService } from '../users/users.service';

import type {
  AccessInfo,
  CreatedMeetingResult,
  MeetingWithOwner,
  MeetingWithOwnerAndParticipants,
  Paginated,
} from './domain/meeting.domain';
import type { MeetingPublicDto } from './dto/meeting-public.dto';
import { assertTransition } from './fsm/meeting-fsm';
import { MeetingsRepository } from './meetings.repository';

/**
 * Бизнес-сервис встреч.
 *
 * Главные сценарии (Фаза 2):
 *   - `createFromCrossmark` — создание встречи через Crossmark API:
 *      ► upsert хоста, создание Meeting + Participant-host в одной транзакции,
 *      ► выдача deep-link JWT (TTL = `cfg.auth.deepLinkTtlSeconds`).
 *   - `getForCrossmark` / `getForUser` / `list` — чтение.
 *   - `cancelScheduled` — `scheduled → failed (cancelled_by_partner)`.
 *   - `getAccess` — определить роль пользователя для страницы встречи (host/guest/none).
 *     НЕ создаёт `Participant` — это делает `/join` (Фаза 2.4).
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsRepository) private readonly meetings: MeetingsRepository,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(MeetingsBalanceService)
    private readonly meetingsBalance: MeetingsBalanceService,
  ) {}

  /**
   * CRIT-3: для каждого Meeting обязателен tenantId (Org). Резолвим default-Org
   * владельца — сначала owned (персональный), иначе первый по joinedAt
   * Membership. На каждого активного юзера такой Org гарантирован через
   * `backfill-orgs-fase0.ts` / signup-flow. Если Org нет — отказ.
   */
  private async resolveDefaultTenant(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const owned = await client.org.findFirst({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (owned) return owned.id;
    const ms = await client.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      orderBy: { joinedAt: 'asc' },
      select: { orgId: true },
    });
    if (ms) return ms.orgId;
    throw new NotAuthorizedError('no_org_for_user');
  }

  /**
   * ТЗ 2026-05-27 (billing) Фаза 3: списываем 1 встречу из накопительного
   * MeetingsBalance вместо старой месячной квоты meetings_per_month.
   *
   * Разрешение tenantId: только если у юзера ровно одна Org-membership
   * (то же поведение, что было у checkMeetingsMonthlyQuota — не пытаемся
   * угадывать когда membership'ов несколько; в этом случае пользователь
   * шлёт явный X-Org-Id и логика проверки уходит в Controller/Guard
   * — на которые это место не имеет доступа).
   *
   * При недостатке баланса — ForbiddenException (бизнес-блок). При инфра-
   * сбоях — fail-open: лучше дать встречу бесплатно, чем заблокировать
   * клиента из-за упавшего Redis/PG (унаследовано от старой квоты).
   */
  private async consumeMeetingFromBalance(userId: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      take: 2,
    });
    if (memberships.length !== 1 || !memberships[0]) return;
    const tenantId = memberships[0].orgId;
    try {
      await this.meetingsBalance.consume(tenantId, 1);
    } catch (err) {
      // ForbiddenException — это HttpException про недостаток баланса,
      // пробрасываем; остальное (БД упала и т.п.) — fail-open.
      if (
        err instanceof Error &&
        (err.name === 'ForbiddenException' ||
          (err as { status?: number }).status === 403)
      ) {
        throw err;
      }
      this.logger.warn(
        `consumeMeetingFromBalance: fail для ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ────────────────────────── создание ──────────────────────────────────

  async createFromCrossmark(
    input: {
      host: { externalId: string; email: string; name: string };
      type: MeetingType;
      title: string;
      customPrompt?: string | null;
    },
    _partnerId: string,
  ): Promise<CreatedMeetingResult> {
    // 1. upsert юзера (отдельная транзакция).
    const user = await this.users.upsertFromCrossmark(input.host);

    // 2. ULID — детерминирован по времени, отсортирован, безопасен для public URL.
    const meetingId = ulid();

    // 3. транзакция: Meeting + host-Participant.
    await this.prisma.$transaction(async (tx) => {
      const tenantId = await this.resolveDefaultTenant(user.id, tx);
      await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: user.id,
          tenantId,
          customPrompt: input.customPrompt ?? null,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${user.id}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId: user.id,
        },
      });
    });

    // 4. deep-link JWT.
    const deepLinkJwt = this.jwt.signDeepLink({ sub: user.id, meetingId });
    const url = `${this.cfg.auth.publicFrontendUrl}/m/${meetingId}?t=${deepLinkJwt}`;
    const expiresAt = new Date(Date.now() + this.cfg.auth.deepLinkTtlSeconds * 1000);

    // 5. метрики.
    this.metrics.incMeetingCreated(input.type);
    this.metrics.incCrossmarkApiRequest('POST /meetings', 201);

    this.logger.log(
      `Создана встреча ${meetingId} (тип=${input.type}, owner=${user.id})`,
    );

    return { meetingId, deepLink: url, expiresAt };
  }

  /**
   * Создание встречи под уже залогиненного пользователя (Фаза 7.5).
   * Возврат — сама встреча, без deep-link (хост уже в cookie).
   *
   * Если передан `cardId` — встреча создаётся уже привязанной к карточке
   * (главный сценарий «Запланировать встречу» с карточки). Owner-проверка
   * карточки внутри транзакции; при невалидной/чужой/удалённой — `NotAuthorizedError`.
   */
  async createForUser(
    input: {
      type: MeetingType;
      title: string;
      customPrompt?: string | null;
      cardId?: string | null;
      recordByDefault?: boolean;
    },
    userId: string,
  ): Promise<Meeting> {
    // ТЗ 2026-05-27 (billing) Фаза 3: накопительный MeetingsBalance вместо
    // месячной квоты meetings_per_month.
    await this.consumeMeetingFromBalance(userId);

    const meetingId = ulid();
    let created!: Meeting;

    await this.prisma.$transaction(async (tx) => {
      // Подтверждаем что пользователь существует — иначе FK упадёт менее наглядно.
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotAuthorizedError('user_not_found');

      // Если cardId задан — проверяем владение и не-удалённость.
      let resolvedCardId: string | null = null;
      if (input.cardId) {
        const card = await tx.card.findUnique({
          where: { id: input.cardId },
          select: { id: true, ownerId: true, deletedAt: true },
        });
        if (!card || card.ownerId !== userId || card.deletedAt !== null) {
          throw new NotAuthorizedError('card_not_found');
        }
        resolvedCardId = card.id;
      }

      const tenantId = await this.resolveDefaultTenant(userId, tx);
      created = await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: userId,
          tenantId,
          customPrompt: input.customPrompt ?? null,
          cardId: resolvedCardId,
          recordByDefault: input.recordByDefault ?? true,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${userId}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });

      // Денормализация счётчиков карточки. Делается в той же транзакции —
      // консистентно. Без recountMeetings: дешевле прибавить +1.
      if (resolvedCardId) {
        await tx.card.update({
          where: { id: resolvedCardId },
          data: {
            meetingCount: { increment: 1 },
            lastMeetingAt: new Date(),
          },
        });
      }
    });

    this.metrics.incMeetingCreated(input.type);

    // Side-effect онбординг v2: первая встреча → firstMeetingCreatedAt
    void this.prisma.org.updateMany({
      where: { id: created.tenantId, firstMeetingCreatedAt: null },
      data: { firstMeetingCreatedAt: new Date() },
    });

    return created;
  }

  /**
   * Calendar MVP Polish (2026-05-25, Фаза P1) — создание LiveKit-комнаты
   * под событие пользовательского календаря (`POST /api/v1/events` с
   * `kind=meeting`).
   *
   * Отличия от `createForUser`:
   *   - не плодит ULID → используется ULID самого Event (для трассировки
   *     event ↔ meeting через одинаковый префикс времени);
   *   - tenantId приходит готовым (рассчитан в EventsService из CurrentOrg),
   *     не пытаемся резолвить «дефолт» — это сценарий конкретной Org.
   *   - не привязывается к Card (карточка человека из CRM) — это календарь;
   *   - возвращает {meetingId, joinUrl} — joinUrl сохраняется в Event.metadata
   *     и отдаётся клиенту, чтобы показать кнопку «Войти во встречу».
   *
   * roomName = meetingId (как везде; ULID годится для public URL).
   * type — нейтральный `team` (нет специального `calendar_event` в enum;
   * `MeetingType` остаётся для совместимости с AI-промптами по типу).
   */
  async createForCalendarEvent(args: {
    tenantId: string;
    ownerUserId: string;
    title: string;
    scheduledFor: Date;
    eventId: string;
  }): Promise<{ meetingId: string; joinUrl: string }> {
    const { tenantId, ownerUserId, title, eventId } = args;

    const meetingId = ulid();
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: ownerUserId } });
      if (!user) throw new NotAuthorizedError('user_not_found');

      await this.meetings.create(
        {
          id: meetingId,
          title: title.trim().slice(0, 300),
          type: 'team',
          ownerId: ownerUserId,
          tenantId,
          customPrompt: null,
          recordByDefault: true,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${ownerUserId}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId: ownerUserId,
        },
      });
    });

    this.metrics.incMeetingCreated('team');
    const joinUrl = `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}/m/${meetingId}`;
    this.logger.log(
      `Calendar Meeting ${meetingId} создан для события ${eventId} (owner=${ownerUserId}, tenant=${tenantId})`,
    );
    return { meetingId, joinUrl };
  }

  /**
   * Calendar MVP Polish (2026-05-25, Фаза P1) — отмена «запланированной»
   * комнаты при удалении/отмене события календаря.
   *
   * Отличается от `cancelScheduled(id, partnerId)` (Crossmark, выше тем,
   * что:
   *   - не привязан к partner-контексту;
   *   - идемпотентен (если уже отменена/удалена — no-op, не валит);
   *   - не падает на FSM-несовпадении (event может быть удалён уже после
   *     начала встречи — тогда не отменяем status, только лог);
   *   - принимает `reason` (event_deleted | event_cancelled) — пишется
   *     в `failureReason`.
   *
   * НЕ останавливает активный Egress напрямую — RecordingsService.stop
   * требует hostUserId; webhook room_finished подберёт сам, когда комната
   * закроется по таймауту неактивности. Просто пишем warning для трассировки.
   */
  async cancelScheduledForCalendarEvent(args: {
    meetingId: string;
    reason: 'event_deleted' | 'event_cancelled';
  }): Promise<void> {
    const { meetingId, reason } = args;
    const meeting = await this.meetings.findById(meetingId);
    if (!meeting) {
      this.logger.warn(
        { meetingId, reason },
        'cancelScheduledForCalendarEvent: meeting не найден — no-op',
      );
      return;
    }
    if (meeting.deletedAt !== null) {
      // Уже удалена — идемпотентно.
      return;
    }
    // Если встреча уже активна / завершена — статус не трогаем, только soft-delete,
    // чтобы не сломать FSM (FSM запрещает active → failed без явного перехода).
    if (meeting.status === 'scheduled') {
      try {
        await this.meetings.updateStatus(meetingId, 'failed', {
          failureReason: reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'cancelScheduledForCalendarEvent: не удалось перевести статус → failed, продолжаю',
        );
      }
    } else {
      // active / *_processing / ready / failed — soft-delete без смены статуса.
      this.logger.warn(
        { meetingId, status: meeting.status, reason },
        'cancelScheduledForCalendarEvent: встреча уже не scheduled — только soft-delete',
      );
      // Проверим активную запись для трассировки (Egress останавливать не пробуем —
      // нет userId хоста в контракте, webhook room_finished подберёт сам).
      const recording = await this.prisma.recording.findUnique({
        where: { meetingId },
        select: { status: true, compositeEgressId: true },
      });
      if (
        recording?.status === 'requested' ||
        recording?.status === 'recording'
      ) {
        this.logger.warn(
          {
            meetingId,
            recordingStatus: recording.status,
            compositeEgressId: recording.compositeEgressId,
          },
          'cancelScheduledForCalendarEvent: запись активна, ожидаем room_finished webhook для остановки',
        );
      }
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(
      `Calendar Meeting ${meetingId} отменён (reason=${reason})`,
    );
  }

  // ────────────────────────── чтение ─────────────────────────────────────

  async getForCrossmark(id: string): Promise<MeetingPublicDto> {
    const meeting = await this.meetings.findByIdWithOwner(id);
    if (!meeting) throw new MeetingNotFoundError(id);
    return this.toPublicDto(meeting);
  }

  async getForUser(id: string, userId: string): Promise<MeetingWithOwnerAndParticipants> {
    const meeting = await this.meetings.findByIdWithOwnerAndParticipants(id);
    if (!meeting) throw new MeetingNotFoundError(id);
    if (meeting.ownerId !== userId) {
      // По ТЗ Фазы 2 — детали может видеть только хост. Гость использует /access.
      throw new NotAuthorizedError('not_meeting_host');
    }
    return meeting;
  }

  async list(
    userId: string,
    filters: {
      page: number;
      limit: number;
      query?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: MeetingStatus[];
      type?: MeetingType[];
      cardId?: string;
    },
  ): Promise<Paginated<Meeting>> {
    const { items, total } = await this.meetings.listByOwner(userId, filters);
    return { items, total, page: filters.page, limit: filters.limit };
  }

  /**
   * Определить роль пользователя на встрече БЕЗ создания Participant.
   * `userId === null` → роль `none` (если только нет какого-то «публичного»
   * статуса; в MVP его нет).
   */
  async getAccess(meetingId: string, userId: string | null): Promise<AccessInfo> {
    const meeting = await this.meetings.findByIdWithParticipants(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);

    let role: 'host' | 'guest' | 'none' = 'none';
    if (userId) {
      if (meeting.ownerId === userId) {
        role = 'host';
      } else if (meeting.participants.some((p) => p.userId === userId)) {
        role = 'guest';
      }
    }

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      select: { status: true },
    });
    const isRecordingActive =
      recording?.status === 'requested' || recording?.status === 'recording';

    return {
      role,
      isRecordingActive,
      recordByDefault: meeting.recordByDefault,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
      },
    };
  }

  // ────────────────────────── мутации ────────────────────────────────────

  /**
   * Партнёр может отменить встречу, пока она `scheduled`.
   * После — встреча идёт через FSM (active/completed) — отмена тут невалидна.
   */
  /**
   * Soft-delete встречи (workspace M3a). Хост-only. Помечает `deletedAt`,
   * списки автоматически фильтруют по `deletedAt: null` (см. репозиторий).
   * Идемпотентно: повторный вызов на уже удалённой возвращает без ошибки.
   */
  async softDelete(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.meetings.findById(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    if (meeting.deletedAt !== null) {
      // Уже удалена — no-op, не валим.
      return;
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Встреча ${meetingId} помечена soft-deleted`);
  }

  async cancelScheduled(id: string, _partnerId: string): Promise<void> {
    const meeting = await this.meetings.findById(id);
    if (!meeting) throw new MeetingNotFoundError(id);

    // FSM проверит scheduled → failed; на любом другом исходном статусе — 409.
    assertTransition(meeting.status, 'failed');

    // Дополнительно ограничим: отменять можно только из scheduled.
    if (meeting.status !== 'scheduled') {
      // Этот if не сработает после assertTransition(scheduled→failed),
      // но защищает на случай если в FSM откроют другие переходы в failed.
      throw new NotAuthorizedError('cancel_only_scheduled');
    }

    await this.meetings.updateStatus(id, 'failed', {
      failureReason: 'cancelled_by_partner',
    });
    this.metrics.incCrossmarkApiRequest('DELETE /meetings/:id', 200);
    this.logger.log(`Встреча ${id} отменена партнёром`);
  }

  /**
   * Универсальный FSM-переход. Используется webhook-обработчиком и host-controls.
   *
   * Семантика:
   *   1. В транзакции читаем текущий статус.
   *   2. `assertTransition(from, to)` — бросит `InvalidFsmTransitionError` на запрет.
   *   3. Обновляем `status` + опциональные поля (startedAt/endedAt/failureReason).
   *   4. Записываем `MeetingEvent` (event_type = `fsm:<from>->to>`).
   *
   * Возвращаем обновлённую встречу.
   */
  async transitionStatus(
    meetingId: string,
    toStatus: MeetingStatus,
    extras: {
      startedAt?: Date | null;
      endedAt?: Date | null;
      failureReason?: string | null;
      reason?: string;
    } = {},
  ): Promise<Meeting> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.meeting.findUnique({ where: { id: meetingId } });
      if (!current) throw new MeetingNotFoundError(meetingId);

      assertTransition(current.status, toStatus);

      const updated = await tx.meeting.update({
        where: { id: meetingId },
        data: {
          status: toStatus,
          ...(extras.startedAt !== undefined ? { startedAt: extras.startedAt } : {}),
          ...(extras.endedAt !== undefined ? { endedAt: extras.endedAt } : {}),
          ...(extras.failureReason !== undefined
            ? { failureReason: extras.failureReason }
            : {}),
        },
      });

      await tx.meetingEvent.create({
        data: {
          meetingId,
          eventType: `fsm:${current.status}->${toStatus}`,
          payload: {
            from: current.status,
            to: toStatus,
            ...(extras.reason ? { reason: extras.reason } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  // ────────────────────────── result page (Фаза 7.6) ─────────────────────

  /**
   * Полные данные result-страницы для host'а.
   *
   * Возвращает:
   *   - meeting + participants
   *   - aiResult (если есть; иначе null — ещё в процессе)
   *   - recording info (БЕЗ presigned URL — отдельный endpoint /recording/download)
   *   - transcript info (есть/нет mergedJson)
   *   - флаг `aiReady` (для удобства фронта).
   */
  async getResult(
    meetingId: string,
    userId: string,
  ): Promise<{
    meeting: {
      id: string;
      title: string;
      type: MeetingType;
      status: MeetingStatus;
      startedAt: string | null;
      endedAt: string | null;
      createdAt: string;
      customPrompt: string | null;
      failureReason: string | null;
      cardId: string | null;
    };
    participants: Array<{
      id: string;
      name: string;
      role: 'host' | 'guest';
      joinedAt: string | null;
      leftAt: string | null;
    }>;
    aiResult: {
      summary: string;
      structuredData: unknown;
      customOutputMd: string | null;
      followUpEmail: string | null;
      tasks: unknown;
      modelUsed: string;
      createdAt: string;
      /**
       * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетная сводка для
       * пользовательского UI (`MeetingReportFastWorker`).
       */
      summaryFast: string | null;
      summaryFastModel: string | null;
      summaryFastGeneratedAt: string | null;
      /**
       * Сводка предыдущего поколения (knowledge-core v2). Fallback, если
       * `summaryFast` ещё не сгенерирован. Поле сохраняется до полного
       * удаления v2-агентов (через 2 недели A/B-сравнения).
       */
      summaryV2: string | null;
      summaryV2Model: string | null;
      summaryV2GeneratedAt: string | null;
    } | null;
    recording: {
      hasRecording: boolean;
      status: string;
      durationSeconds: number | null;
      bytesTotal: string | null;
      expiresAt: string | null;
    } | null;
    transcript: {
      hasMerged: boolean;
      totalDurationSeconds: number | null;
    } | null;
    aiReady: boolean;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        participants: true,
        recording: true,
        transcript: true,
        aiResult: true,
      },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        createdAt: meeting.createdAt.toISOString(),
        customPrompt: meeting.customPrompt ?? null,
        failureReason: meeting.failureReason ?? null,
        cardId: meeting.cardId ?? null,
      },
      participants: meeting.participants.map((p: Participant) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
      aiResult: meeting.aiResult
        ? this.toAiResultDto(meeting.aiResult)
        : null,
      recording: meeting.recording
        ? this.toRecordingDto(meeting.recording)
        : null,
      transcript: meeting.transcript
        ? this.toTranscriptDto(meeting.transcript)
        : null,
      aiReady: meeting.status === 'ai_ready',
    };
  }

  /**
   * Краткий статус для polling'а result-страницы. Не нагружает БД участниками/AI.
   */
  async getResultStatus(
    meetingId: string,
    userId: string,
  ): Promise<{ stage: MeetingStatus; failureReason: string | null }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, status: true, failureReason: true },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    return { stage: meeting.status, failureReason: meeting.failureReason ?? null };
  }

  /**
   * Данные транскрипта (turns + roomChat) из БД. Только для host'а.
   * Если transcript.turns ещё нет — 404.
   */
  async getTranscript(
    meetingId: string,
    userId: string,
  ): Promise<{
    turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    roomChat?: Array<{ sentAt: string; authorName: string; content: string }>;
    durationSeconds: number | null;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: { select: { turns: true, roomChat: true, totalDurationSeconds: true } } },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t?.turns) {
      throw new MeetingNotFoundError(`transcript:${meetingId}`);
    }

    const turns = t.turns as Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    const roomChat = (t.roomChat as Array<{ sentAt: string; authorName: string; content: string }> | null) ?? undefined;
    return {
      turns,
      ...(roomChat && roomChat.length > 0 ? { roomChat } : {}),
      durationSeconds: t.totalDurationSeconds ?? null,
    };
  }

  // ────────────────────────── helpers ────────────────────────────────────

  private toAiResultDto(r: AiResult): {
    summary: string;
    structuredData: unknown;
    customOutputMd: string | null;
    followUpEmail: string | null;
    tasks: unknown;
    modelUsed: string;
    createdAt: string;
    summaryFast: string | null;
    summaryFastModel: string | null;
    summaryFastGeneratedAt: string | null;
    summaryV2: string | null;
    summaryV2Model: string | null;
    summaryV2GeneratedAt: string | null;
  } {
    return {
      summary: r.summary,
      structuredData: r.structuredData ?? null,
      customOutputMd: r.customOutputMd ?? null,
      followUpEmail: r.followUpEmail ?? null,
      tasks: r.tasks ?? null,
      modelUsed: r.modelUsed,
      createdAt: r.createdAt.toISOString(),
      // ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетная сводка для UI.
      summaryFast: r.summaryFast ?? null,
      summaryFastModel: r.summaryFastModel ?? null,
      summaryFastGeneratedAt: r.summaryFastGeneratedAt?.toISOString() ?? null,
      summaryV2: r.summaryV2 ?? null,
      summaryV2Model: r.summaryV2Model ?? null,
      summaryV2GeneratedAt: r.summaryV2GeneratedAt?.toISOString() ?? null,
    };
  }

  private toRecordingDto(r: Recording): {
    hasRecording: boolean;
    status: string;
    durationSeconds: number | null;
    bytesTotal: string | null;
    expiresAt: string | null;
  } {
    const ready = r.status === 'ready' && !!r.mainVideoUrl;
    return {
      hasRecording: ready,
      status: r.status,
      durationSeconds: r.durationSeconds ?? null,
      bytesTotal: r.bytesTotal !== null ? r.bytesTotal.toString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    };
  }

  private toTranscriptDto(t: Transcript): {
    hasMerged: boolean;
    totalDurationSeconds: number | null;
  } {
    return {
      hasMerged: t.turns !== null,
      totalDurationSeconds: t.totalDurationSeconds ?? null,
    };
  }

  private toPublicDto(meeting: MeetingWithOwner): MeetingPublicDto {
    return {
      id: meeting.id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      started_at: meeting.startedAt?.toISOString() ?? null,
      ended_at: meeting.endedAt?.toISOString() ?? null,
      failure_reason: meeting.failureReason ?? null,
      created_at: meeting.createdAt.toISOString(),
      owner: {
        external_id: meeting.owner.externalId,
        email: meeting.owner.email,
        name: meeting.owner.name,
      },
    };
  }
}
