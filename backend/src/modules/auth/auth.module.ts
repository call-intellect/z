import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AdminGuard } from './guards/admin.guard';
import { CookieAuthGuard } from './guards/cookie-auth.guard';
import { HmacGuard } from './guards/hmac.guard';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminLoginService } from './services/admin-login.service';
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
 *
 * Контроллер `/api/v1/auth/{exchange,me,logout}` использует `UsersService`
 * (найти пользователя по deep-link). `UsersModule` глобален, поэтому
 * импортировать его в `AuthModule` не нужно.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    JwtService,
    HmacService,
    AdminLoginService,
    CookieAuthGuard,
    HmacGuard,
    AdminGuard,
    SuperAdminGuard,
    OrgAdminGuard,
  ],
  exports: [
    JwtService,
    HmacService,
    AdminLoginService,
    CookieAuthGuard,
    HmacGuard,
    AdminGuard,
    SuperAdminGuard,
    OrgAdminGuard,
  ],
})
export class AuthModule {}
