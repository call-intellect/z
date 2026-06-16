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
