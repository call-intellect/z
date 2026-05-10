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
import { EntitlementService } from '../entitlements/entitlement.service';
import { QuotaService } from '../quotas/quota.service';
import { S3Service } from '../recordings/s3.service';
import { extractKeyFromUrl } from '../recordings/s3-keys';
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
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(QuotaService) private readonly quotas: QuotaService,
  ) {}

  /**
   * Phase 12: Org-wide месячная квота `meetings_per_month`.
   * Резолвим tenantId через единственное активное членство (heuristic — то же,
   * что использует TenantGuard для default Org). При ошибке/нет Org —
   * fail-open: создание встречи не блокируем.
   *
   * Окно — календарный месяц (~30 дней) в скользящем формате через windowMs.
   */
  private async checkMeetingsMonthlyQuota(userId: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      take: 2,
    });
    if (memberships.length !== 1 || !memberships[0]) return;
    const tenantId = memberships[0].orgId;
    try {
      const max = await this.entitlements.getQuota(tenantId, 'meetings_per_month');
      await this.quotas.checkAndIncrementOrg({
        tenantId,
        quotaName: 'meetings_per_month',
        max,
        windowMs: 30 * 24 * 3600 * 1000,
      });
    } catch (err) {
      // QuotaExceededError должен пробрасываться (это HttpException);
      // только остальные сбои (Redis недоступен и т.п.) — fail-open.
      if (err instanceof Error && err.name === 'QuotaExceededError') throw err;
      this.logger.warn(
        `checkMeetingsMonthlyQuota: getQuota/check fail для ${tenantId}: ${
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
      await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: user.id,
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
    },
    userId: string,
  ): Promise<Meeting> {
    // Phase 12: cap meetings_per_month per Org tier'а.
    await this.checkMeetingsMonthlyQuota(userId);

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

      created = await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: userId,
          customPrompt: input.customPrompt ?? null,
          cardId: resolvedCardId,
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

    return created;
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
        // зарегистрированный гость (V2-сценарий, в MVP редкий).
        role = 'guest';
      }
    }

    return {
      role,
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
   * Presigned URL на merged-json транскрипта. Только для host'а.
   * Если транскрипта/merged ещё нет — 404 (через `MeetingNotFoundError`-подобный).
   */
  async getTranscript(
    meetingId: string,
    userId: string,
  ): Promise<{ url: string; expiresAt: string; durationSeconds: number | null }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: true },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t || !t.mergedS3Url) {
      // Семантически — 404: merged.json ещё не готов. Используем тот же тип, что и для встречи.
      throw new MeetingNotFoundError(`transcript:${meetingId}`);
    }

    const key = extractKeyFromUrl(t.mergedS3Url, this.cfg.s3.bucket);
    const presigned = await this.s3.presignGet(key);
    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
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
  } {
    return {
      summary: r.summary,
      structuredData: r.structuredData ?? null,
      customOutputMd: r.customOutputMd ?? null,
      followUpEmail: r.followUpEmail ?? null,
      tasks: r.tasks ?? null,
      modelUsed: r.modelUsed,
      createdAt: r.createdAt.toISOString(),
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
      hasMerged: !!t.mergedS3Url,
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
