import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { FeedSubscriptionsController } from './controllers/feed-subscriptions.controller';
import { FeedController } from './controllers/feed.controller';
import { FeedDigestCron } from './cron/feed-digest.cron';
import { FeedExpireCron } from './cron/feed-expire.cron';
import { ActivityFeedGateway } from './gateways/activity-feed.gateway';
import { ActivityFeedService } from './services/activity-feed.service';
import { CoraFeedService } from './services/cora-feed.service';

/**
 * ActivityFeedModule (Wave 2 Поток D, 2026-05-24).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md
 *
 * Глобальный модуль (`@Global`), чтобы любой агент (Probe / Insights Radar /
 * Decisions Registry / Issue / Ideas / Curation) мог инжектить
 * `ActivityFeedService.publish(...)` без повторного импорта.
 *
 * Состав:
 *   - ActivityFeedService — единая точка publish + status FSM + reactions + expire.
 *   - ActivityFeedGateway — WebSocket namespace `/ws/feed`.
 *   - FeedController              — REST `/api/v1/feed`.
 *   - FeedSubscriptionsController — REST `/api/v1/feed-subscriptions`.
 *   - FeedExpireCron — каждые 15 минут ставит status='expired' просроченным записям.
 *   - FeedDigestCron — daily / weekly digest (доставка через каналы — TODO).
 *
 * Зависимости (через @Global):
 *   - PrismaService, RedisService, TypedConfigService, BusinessMetricsService.
 *   - RbacService (через @Global() RbacModule).
 *   - JwtService (через AuthModule import — для WS handshake'а).
 *
 * Регистрация в AppModule — после AuthModule, RbacModule, MetricsModule,
 * ScheduleModule. Не зависит от ProbeModule / InsightsModule / IdeasModule
 * (это они зависят от feed-сервиса, не наоборот).
 */
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
