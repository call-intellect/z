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
