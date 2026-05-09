import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';


export interface CurrentUserPayload {
  id: string;
  email: string;
  role: 'user' | 'admin';
  /** JWT ID — присутствует только для standalone-сессий. */
  jti?: string;
  /**
   * LiveKit identity участника. Заполняется только room-chat guard'ом
   * (`MeetingMemberGuard`) при гостевом доступе (см. ТЗ meeting-room-chat).
   * Для всех «нормальных» юзер-эндпоинтов остаётся undefined.
   */
  livekitIdentity?: string;
  /** Participant.id (только для гостей через room-chat guard). */
  participantId?: string;
  /** Имя гостя из Participant — для денормализации authorName в room-chat. */
  name?: string;
}

/**
 * Достаёт `req.user`, заполненный `CookieAuthGuard`. Может быть `null` при
 * `@OptionalAuth()` без cookie. Если guard не подключён — будет `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload | null | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user ?? undefined;
  },
);
