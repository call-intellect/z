import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PushSubscriptionsController } from './controllers/push-subscriptions.controller';
import { PushCleanupCron } from './cron/push-cleanup.cron';
import { PushSubscriptionsService } from './services/push-subscriptions.service';
import { WebPushSender } from './services/web-push-sender.service';
import { PushSenderWorker } from './workers/push-sender.worker';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PushSubscriptionsController],
  providers: [PushSubscriptionsService, WebPushSender, PushSenderWorker, PushCleanupCron],
  exports: [PushSubscriptionsService, WebPushSender],
})
export class PushModule {}
