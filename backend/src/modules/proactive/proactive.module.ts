import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { MyProactiveNotificationsController } from './controllers/my-proactive-notifications.controller';
import { ProactiveDedupService } from './services/proactive-dedup.service';
import { ProactiveMessageCraftService } from './services/proactive-message-craft.service';
import { ProactiveNotificationsService } from './services/proactive-notifications.service';
import { ProactiveWatcherService } from './services/proactive-watcher.service';
import { ProactiveWatcherCron } from './workers/proactive-watcher.cron';

@Module({
  imports: [PrismaModule],
  controllers: [MyProactiveNotificationsController],
  providers: [
    ProactiveDedupService,
    ProactiveMessageCraftService,
    ProactiveNotificationsService,
    ProactiveWatcherService,
    ProactiveWatcherCron,
  ],
  exports: [ProactiveWatcherService, ProactiveNotificationsService, ProactiveDedupService],
})
export class ProactiveModule {}
