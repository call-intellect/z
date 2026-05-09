import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Meeting, type MeetingStatus, type MeetingType } from '@prisma/client';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../common/config/index';
import {
  MeetingNotFoundError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';
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
  ) {}

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
   */
  async createForUser(
    input: { type: MeetingType; title: string; customPrompt?: string | null },
    userId: string,
  ): Promise<Meeting> {
    const meetingId = ulid();
    let created!: Meeting;

    await this.prisma.$transaction(async (tx) => {
      // Подтверждаем что пользователь существует — иначе FK упадёт менее наглядно.
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotAuthorizedError('user_not_found');

      created = await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: userId,
          customPrompt: input.customPrompt ?? null,
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
    filters: { page: number; limit: number; status?: MeetingStatus; type?: MeetingType },
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

  // ────────────────────────── helpers ────────────────────────────────────

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
