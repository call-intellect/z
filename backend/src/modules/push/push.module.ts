import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PushChannelAdapter } from './adapters/push-channel.adapter';
import { PushSubscriptionsController } from './controllers/push-subscriptions.controller';
import { PushTokensController } from './controllers/push-tokens.controller';
import { PushCleanupCron } from './cron/push-cleanup.cron';
import { ApnsSender } from './services/apns-sender.service';
import { FcmSender } from './services/fcm-sender.service';
import { PushSubscriptionsService } from './services/push-subscriptions.service';
import { PushService } from './services/push.service';
import { RustoreSender } from './services/rustore-sender.service';
import { WebPushSender } from './services/web-push-sender.service';
import { PushSenderWorker } from './workers/push-sender.worker';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [PushSubscriptionsController, PushTokensController],
  providers: [
    PushSubscriptionsService,
    WebPushSender,
    PushSenderWorker,
    PushCleanupCron,
    ApnsSender,
    FcmSender,
    RustoreSender,
    PushService,
    PushChannelAdapter,
  ],
  exports: [PushSubscriptionsService, WebPushSender, PushService],
})
export class PushModule {}
