import { SetMetadata } from '@nestjs/common';

/**
 * Метка для `CookieAuthGuard`: если cookie отсутствует — пропустить дальше с
 * `req.user = null` вместо 401.
 *
 * Используется для роутов, где гость и зарегистрированный пользователь имеют
 * один и тот же endpoint (например, `POST /meetings/:id/join`), и решение
 * принимает контроллер по `req.user`.
 */
export const OPTIONAL_AUTH_KEY = 'auth:optional';

export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(OPTIONAL_AUTH_KEY, true);
