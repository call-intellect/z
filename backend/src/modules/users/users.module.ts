import { Global, Module } from '@nestjs/common';

import { TourProgressController } from './controllers/tour-progress.controller';
import { TourProgressService } from './tour-progress.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

/**
 * Глобальный модуль пользователей. `UsersService` доступен везде через DI —
 * нужен в Auth (deep-link exchange, `/me`), Meetings (создание встречи),
 * Admin (V2).
 *
 * Onboarding Tour (ТЗ 2026-05-27): `TourProgressController` обслуживает
 * `/api/v1/users/me/tour-progress` (GET/PATCH/POST reset), `TourProgressService`
 * локальный (не экспортируется — нет других потребителей).
 * `BusinessMetricsService` приходит через @Global() из `MetricsModule`.
 */
@Global()
@Module({
  controllers: [TourProgressController],
  providers: [UsersService, UsersRepository, TourProgressService],
  exports: [UsersService],
})
export class UsersModule {}
