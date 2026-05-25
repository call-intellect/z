import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { CronManagerController } from './admin-crons.controller';
import { CronManagerService } from './cron-manager.service';

/**
 * Admin-redesign Фаза 0 — `AdminCronsModule`.
 *
 * `DiscoveryModule` нужен, чтобы `CronManagerService` мог сканировать
 * провайдеры приложения и находить @Cron-методы.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [CronManagerController],
  providers: [CronManagerService],
  exports: [CronManagerService],
})
export class AdminCronsModule {}
