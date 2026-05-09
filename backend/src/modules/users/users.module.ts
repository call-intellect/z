import { Global, Module } from '@nestjs/common';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Глобальный модуль пользователей. `UsersService` доступен везде через DI —
 * нужен в Auth (deep-link exchange, `/me`), Meetings (создание встречи),
 * Admin (V2).
 */
@Global()
@Module({
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
