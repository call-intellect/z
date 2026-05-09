import { Global, Module } from '@nestjs/common';

import { AdminGuard } from './guards/admin.guard';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { HmacGuard } from './guards/hmac.guard';
import { HmacService } from './services/hmac.service';
import { JwtService } from './services/jwt.service';

/**
 * Глобальный auth-модуль.
 *
 * Экспортирует:
 *   - `JwtService`      — для подписи/проверки session/deep-link JWT;
 *   - `HmacService`     — для проверки/выдачи интеграционных ключей;
 *   - `CookieAuthGuard` — для пользовательских роутов (с `@OptionalAuth()` режимом);
 *   - `HmacGuard`       — для Crossmark-роутов (HMAC + idempotency);
 *   - `AdminGuard`      — после `CookieAuthGuard` для admin-роутов.
 */
@Global()
@Module({
  providers: [JwtService, HmacService, CookieAuthGuard, HmacGuard, AdminGuard],
  exports: [JwtService, HmacService, CookieAuthGuard, HmacGuard, AdminGuard],
})
export class AuthModule {}
