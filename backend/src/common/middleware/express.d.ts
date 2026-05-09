/**
 * Расширение типов Express: каждый request имеет `id`,
 * который ставит RequestIdMiddleware (X-Request-Id или nanoid).
 *
 * Файл — ambient: импортов не требует.
 */

declare global {
  namespace Express {
    interface Request {
      /**
       * Уникальный идентификатор запроса.
       * Берётся из заголовка `X-Request-Id` или генерится через nanoid(12).
       * Используется в логах (pino customProps) и в payload-ответе ошибок.
       */
      id: string;
    }
  }
}

export {};
