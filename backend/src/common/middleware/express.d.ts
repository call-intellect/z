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
      /**
       * Org/tenant ID, выставленный TenantMiddleware из заголовка X-Org-Id /
       * URL-параметра :orgId / body.tenantId. Может остаться undefined — тогда
       * TenantGuard добьёт через single-org fallback по req.user.id.
       */
      tenantId?: string;
    }
  }
}

export {};
