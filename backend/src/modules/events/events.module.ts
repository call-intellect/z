import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ConversationalModule } from '../conversational/conversational.module';
import { KnowledgeCoreModule } from '../knowledge-core/knowledge-core.module';

import { EventsController } from './events.controller';
import { IcsFeedController } from './ics-feed.controller';
import { EventReminderSchedulerCron } from './services/event-reminder-scheduler.cron';
import { EventsService } from './services/events.service';
import { FindFreeSlotService } from './services/find-free-slot.service';
import { IcsFeedService } from './services/ics-feed.service';
import { EventRemindersWorker } from './workers/event-reminders.worker';

/**
 * EventsModule (SBA α-3 + Calendar MVP 2026-05-25).
 *
 * REST API событий: `/api/v1/events`, `/api/v1/me/calendar`,
 * `/api/v1/users/:userId/calendar`.
 *
 * Event связан 1:1 с Entity{type=event}. Создание через REST переиспользует
 * `EntityResolutionService.findOrCreateEntity({type:'event'})` —
 * импортируется из `KnowledgeCoreModule`.
 *
 * Calendar MVP добавил:
 *   - CRUD + RSVP + календарное представление + find-free-slot;
 *   - `EventReminderSchedulerCron` (sweeper, каждую минуту);
 *   - `EventRemindersWorker` (BullMQ consumer `core.event-reminders`).
 *
 * RbacModule / AuthModule — глобальные, не импортируем явно.
 * BusinessMetricsService, EventEmitter2, CoreQueueService, RedisService —
 * глобальные.
 */
@Module({
  imports: [PrismaModule, KnowledgeCoreModule, ConversationalModule],
  controllers: [EventsController, IcsFeedController],
  providers: [
    EventsService,
    FindFreeSlotService,
    IcsFeedService,
    EventReminderSchedulerCron,
    EventRemindersWorker,
  ],
  exports: [EventsService, FindFreeSlotService, IcsFeedService],
})
export class EventsModule {}
