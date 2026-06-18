import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { FeedSubscriptionsController } from './controllers/feed-subscriptions.controller';
import { FeedController } from './controllers/feed.controller';
import { FeedDigestCron } from './cron/feed-digest.cron';
import { FeedExpireCron } from './cron/feed-expire.cron';
import { ActivityFeedGateway } from './gateways/activity-feed.gateway';
import { ActivityFeedService } from './services/activity-feed.service';
import { CoraFeedService } from './services/cora-feed.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FeedController, FeedSubscriptionsController],
  providers: [
    ActivityFeedService,
    CoraFeedService,
    ActivityFeedGateway,
    FeedExpireCron,
    FeedDigestCron,
  ],
  exports: [ActivityFeedService, CoraFeedService],
})
export class ActivityFeedModule {}
