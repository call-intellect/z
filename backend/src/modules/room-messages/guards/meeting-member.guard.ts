import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtService } from '../../auth/services/jwt.service';
import { ParticipantsService } from '../../participants/participants.service';

/**
 * Guard для room-chat endpoints: пускает и зарегистрированного юзера
 * (cookie `z_session`), и гостя (cookie `guest_session_<meetingId>`).
 *
 *   - Если есть `z_session` — валидируем session JWT, проверяем UserSession
 *     для standalone-сессий, кладём `req.user = { id, email, role, jti? }`.
 *   - Если есть `guest_session_<meetingId>` — валидируем guest JWT, поднимаем
 *     Participant, кладём `req.user = { id: '', livekitIdentity, name }`.
 *   - Если нет ни одной валидной cookie — 401.
 *
 * Доменная проверка участия (является ли user участником встречи) делается
 * в сервисе — гард только устанавливает `req.user`.
 */
const SESSION_COOKIE = 'z_session';

@Injectable()
export class MeetingMemberGuard implements CanActivate {
  private readonly logger = new Logger(MeetingMemberGuard.name);

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const meetingId = this.extractMeetingId(request);

    // 1. Сначала пробуем session cookie.
    const sessionToken = this.readCookie(request, SESSION_COOKIE);
    if (sessionToken) {
      try {
        const payload = this.jwt.verifySession(sessionToken);
        if (payload.jti) {
          const session = await this.prisma.userSession.findUnique({
            where: { jti: payload.jti },
          });
          const valid =
            session !== null &&
            session.revokedAt === null &&
            session.expiresAt.getTime() > Date.now();
          if (!valid) {
            throw new UnauthorizedException({
              ok: false,
              error: { code: 'session_revoked', message: 'Сессия больше недействительна' },
            });
          }
        }
        request.user = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          ...(payload.jti ? { jti: payload.jti } : {}),
        };
        return true;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        // Битый/просроченный session JWT — продолжаем пробовать guest.
        this.logger.debug({ err: error }, 'session JWT invalid, fallback to guest');
      }
    }

    // 2. Гостевая cookie — её имя зависит от meetingId.
    if (!meetingId) {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_missing', message: 'Требуется авторизация' },
      });
    }
    const guestCookieName = ParticipantsService.guestCookieName(meetingId);
    const guestToken = this.readCookie(request, guestCookieName);
    if (!guestToken) {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_missing', message: 'Требуется авторизация' },
      });
    }
    let guestPayload;
    try {
      guestPayload = this.jwt.verifyGuestSession(guestToken);
    } catch {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_invalid', message: 'Сессия недействительна' },
      });
    }
    if (guestPayload.meetingId !== meetingId) {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'cookie_meeting_mismatch', message: 'Сессия не для этой встречи' },
      });
    }
    const participant = await this.prisma.participant.findUnique({
      where: { id: guestPayload.participantId },
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'guest_participant_not_found', message: 'Гость больше не привязан' },
      });
    }
    request.user = {
      id: '',
      email: '',
      role: 'user',
      livekitIdentity: participant.livekitIdentity,
      participantId: participant.id,
      name: participant.name,
    };
    return true;
  }

  private extractMeetingId(req: Request): string | null {
    // Express заполняет params только после маршрутизации; в guard'е они уже доступны.
    const params = req.params as Record<string, string | undefined>;
    return params['meetingId'] ?? params['id'] ?? null;
  }

  private readCookie(req: Request, name: string): string | null {
    const fromParser = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
    if (fromParser) return fromParser;

    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx);
      if (key === name) {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }
    return null;
  }
}
