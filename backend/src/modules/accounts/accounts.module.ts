import { Module } from '@nestjs/common';

import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * Модуль standalone-аккаунтов (lead-style регистрация, login, профиль).
 *
 * `AuthModule` уже глобален → `JwtService` и `CookieAuthGuard` доступны через DI.
 * `MailModule` тоже глобален → `MailService` / `DisposableEmailService` доступны.
 * `PrismaModule` глобален → `PrismaService` доступен.
 */
@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    AccountsRepository,
    PasswordService,
    SessionService,
  ],
  exports: [AccountsService, SessionService],
})
export class AccountsModule {}
