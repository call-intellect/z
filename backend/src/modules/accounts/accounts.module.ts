import { Module } from '@nestjs/common';

import { OrgsModule } from '../orgs/orgs.module';

import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { UnifiedLoginController } from './unified-login.controller';

/**
 * Модуль standalone-аккаунтов (lead-style регистрация, login, профиль).
 *
 * `AuthModule` уже глобален → `JwtService` и `CookieAuthGuard` доступны через DI.
 * `MailModule` тоже глобален → `MailService` / `DisposableEmailService` доступны.
 * `PrismaModule` глобален → `PrismaService` доступен.
 *
 * OrgsModule импортируем для хука в register: при создании юзера сразу
 * создаётся персональный Org + Membership(owner) (Фаза 0 knowledge-core).
 */
@Module({
  imports: [OrgsModule],
  controllers: [AccountsController, UnifiedLoginController],
  providers: [
    AccountsService,
    AccountsRepository,
    PasswordService,
    SessionService,
  ],
  exports: [AccountsService, SessionService],
})
export class AccountsModule {}
