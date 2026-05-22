import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { EventsController } from './events.controller';
import { EventsService } from './services/events.service';

/**
 * EventsModule (SBA α-3 — категория A онтологии).
 *
 * REST API событий: `/api/v1/events` (read-only на α-3).
 * Event связан 1:1 с Entity{type=event}. Создание Event — через
 * `EntityResolutionService.findOrCreateEventEntity` (в block-ingest и т.п.).
 * Внешнее POST API появится в α-6 / β-3 при необходимости.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
