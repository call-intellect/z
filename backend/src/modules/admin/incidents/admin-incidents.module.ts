import { Module } from '@nestjs/common';

import { AdminIncidentsController } from './admin-incidents.controller';
import { AdminIncidentsService } from './admin-incidents.service';

/**
 * Admin-redesign Фаза 1 — `AdminIncidentsModule`.
 *
 * Импортируется `AdminModule`. Зависимости (`RedisService`) — глобальные.
 */
@Module({
  controllers: [AdminIncidentsController],
  providers: [AdminIncidentsService],
  exports: [AdminIncidentsService],
})
export class AdminIncidentsModule {}
