import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Meeting } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import {
  GuestNameRequiredError,
  MeetingFinishedError,
  MeetingNotFoundError,
} from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';

/**
 * Сервис гостевого/host-join'а.
 *
 * `POST /api/v1/meetings/:id/join`:
 *   - host (по cookie и `userId === ownerId`) — найти/создать host-Participant'а;
 *   - guest — sanitize `guest_name`, переиспользовать guest cookie или создать
 *     нового Participant'а и поставить cookie `guest_session_<meetingId>`.
 *
 * `livekit.token` в Фазе 2 — `null` (заглушка). В Фазе 3.2 заменим на
 * `LivekitService.generateHostToken / generateGuestToken`.
 */

export interface JoinResult {
  participantId: string;
  role: 'host' | 'guest';
  livekitIdentity: string;
  livekit: {
    url: string;
    token: string | null;
  };
  /** Если установили новый guest-cookie — фронт должен принять её. */
  guestSessionCookie?: {
    name: string;
    value: string;
    maxAgeSeconds: number;
  };
}

const GUEST_NAME_MAX_LENGTH = 80;
/** Из имени убираем символы, которые часто используются в XSS-инъекциях. */
const XSS_UNSAFE_CHARS = /[<>&"'/]/g;

@Injectable()
export class ParticipantsService {
  private readonly logger = new Logger(ParticipantsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  static guestCookieName(meetingId: string): string {
    return `guest_session_${meetingId}`;
  }

  /**
   * Очистить пользовательский ввод имени гостя.
   * Возвращает `null`, если после очистки строка пустая или короче 1 символа.
   */
  static sanitizeGuestName(input: string): string | null {
    const stripped = input.replace(XSS_UNSAFE_CHARS, '').trim();
    if (stripped.length === 0) return null;
    return stripped.slice(0, GUEST_NAME_MAX_LENGTH);
  }

  async join(input: {
    meetingId: string;
    userId: string | null;
    guestName: string | null;
    existingGuestCookie: string | null;
  }): Promise<JoinResult> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
    });
    if (!meeting) throw new MeetingNotFoundError(input.meetingId);
    this.assertJoinable(meeting);

    if (input.userId && meeting.ownerId === input.userId) {
      return this.joinAsHost(meeting, input.userId);
    }

    return this.joinAsGuest(
      meeting,
      input.guestName,
      input.existingGuestCookie,
    );
  }

  // ────────────────────────── host ───────────────────────────────────────

  private async joinAsHost(meeting: Meeting, userId: string): Promise<JoinResult> {
    const livekitIdentity = `host:${userId}`;
    let participant = await this.prisma.participant.findUnique({
      where: {
        meetingId_livekitIdentity: {
          meetingId: meeting.id,
          livekitIdentity,
        },
      },
    });

    if (!participant) {
      // Обычно host-Participant создаётся в `createFromCrossmark`. Этот fallback —
      // на случай встреч, заведённых другим путём (`createForUser`, V2-сценарии).
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      participant = await this.prisma.participant.create({
        data: {
          meetingId: meeting.id,
          livekitIdentity,
          name: user?.name ?? 'Host',
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });
      this.logger.log(`Создан host-Participant ${participant.id} для встречи ${meeting.id}`);
    }

    return {
      participantId: participant.id,
      role: 'host',
      livekitIdentity,
      livekit: { url: this.cfg.livekit.apiUrl, token: null },
    };
  }

  // ────────────────────────── guest ──────────────────────────────────────

  private async joinAsGuest(
    meeting: Meeting,
    rawGuestName: string | null,
    existingGuestCookie: string | null,
  ): Promise<JoinResult> {
    // 1. Попытка переиспользовать guest cookie — её хватает и без имени.
    if (existingGuestCookie) {
      try {
        const payload = this.jwt.verifyGuestSession(existingGuestCookie);
        if (payload.meetingId === meeting.id) {
          const existing = await this.prisma.participant.findUnique({
            where: { id: payload.participantId },
          });
          if (existing && existing.meetingId === meeting.id && existing.role === 'guest') {
            return {
              participantId: existing.id,
              role: 'guest',
              livekitIdentity: existing.livekitIdentity,
              livekit: { url: this.cfg.livekit.apiUrl, token: null },
            };
          }
        }
      } catch {
        // Cookie битая/просрочена — упадём в ветку с именем ниже.
      }
    }

    // 2. Имя обязательно, иначе клиенту понадобится ввести.
    if (!rawGuestName) {
      throw new GuestNameRequiredError();
    }
    const cleanName = ParticipantsService.sanitizeGuestName(rawGuestName);
    if (!cleanName) {
      throw new GuestNameRequiredError();
    }

    // 3. Создаём нового Participant'а — `livekit_identity` детерминирован после создания.
    //    Используем `nanoid` (URL-safe, 21 символ ≈ 126 бит энтропии — на порядок
    //    больше, чем нужно для guest-identity в одной встрече).
    const guestId = nanoid();
    const livekitIdentity = `guest:${guestId}`;
    const participant = await this.prisma.participant.create({
      data: {
        meetingId: meeting.id,
        livekitIdentity,
        name: cleanName,
        role: 'guest',
        isRegisteredUser: false,
      },
    });

    // 4. Подписываем guest-cookie — её фронт получит и сохранит.
    const cookieValue = this.jwt.signGuestSession({
      participantId: participant.id,
      meetingId: meeting.id,
    });

    return {
      participantId: participant.id,
      role: 'guest',
      livekitIdentity,
      livekit: { url: this.cfg.livekit.apiUrl, token: null },
      guestSessionCookie: {
        name: ParticipantsService.guestCookieName(meeting.id),
        value: cookieValue,
        maxAgeSeconds: this.jwt.guestSessionTtlSeconds,
      },
    };
  }

  // ────────────────────────── helpers ────────────────────────────────────

  /**
   * Можно ли вообще зайти на встречу.
   * Запрещаем: `failed`; `completed`/`recording_*`/`transcription_*`/`ai_*`,
   * если с момента `endedAt` прошло больше 1 часа.
   */
  private assertJoinable(meeting: Meeting): void {
    if (meeting.status === 'failed') {
      throw new MeetingFinishedError();
    }
    if (
      meeting.status !== 'scheduled' &&
      meeting.status !== 'active' &&
      meeting.endedAt
    ) {
      const oneHourMs = 60 * 60 * 1000;
      if (Date.now() - meeting.endedAt.getTime() > oneHourMs) {
        throw new MeetingFinishedError();
      }
    }
  }
}

