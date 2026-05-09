/**
 * Расширение Express.Request для auth-контекста:
 *   - `user`     — заполняется `CookieAuthGuard` после валидации session JWT.
 *   - `partner`  — заполняется `HmacGuard` после валидации интеграционного ключа.
 *   - `idempotencyKey` — заполняется `HmacGuard`, читается `IdempotencyInterceptor`.
 *   - `rawBody`  — заполняется `RawBodyMiddleware` для верификации подписей.
 *
 * Файл — ambient: импортов не требует.
 */

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'user' | 'admin';
        /**
         * JWT ID. Установлено только для standalone-сессий (Phase 2).
         * Для legacy Crossmark deep-link сессий и admin-логина — undefined.
         * Используется для отзыва конкретной сессии (logout, change-password).
         */
        jti?: string;
        /**
         * LiveKit identity участника. Заполняется `MeetingMemberGuard` для
         * гостей (без `userId`), чтобы room-chat сервис мог искать
         * Participant по этому ключу. Для обычных юзер-эндпоинтов — undefined.
         */
        livekitIdentity?: string;
        /** Participant.id, если guard смог его поднять (только для гостей). */
        participantId?: string;
        /** Имя гостя из Participant — для денормализации authorName. */
        name?: string;
      } | null;
      partner?: {
        id: string;
        partnerName: string;
      };
      idempotencyKey?: string;
      rawBody?: Buffer;
    }
  }
}

export {};
