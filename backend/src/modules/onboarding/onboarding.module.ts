import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { RbacModule } from '../rbac/rbac.module';

import { SubscriptionActivatedListener } from './listeners/subscription-activated.listener';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ConsentService } from './services/consent.service';
import { DemoCleanupQueue } from './workers/demo-cleanup.queue';
import { DemoCleanupWorker } from './workers/demo-cleanup.worker';

/**
 * OnboardingModule.
 *
 * ТЗ 2026-06-01-demo-shared-org-model: shared demo-Org «Демо: ТехноСтрим»,
 * новый user получает membership(demo_observer) к эталону вместо копии данных.
 * При активации платной/бонусной подписки слушатель снимает demo_observer.
 *
 * `DemoCleanupQueue / DemoCleanupWorker` оставлены для force-update эталонной
 * Org (CLI / админка). DemoSeedQueue/Worker удалены — авто-копирование больше
 * не происходит.
 *
 * BillingModule импортируется ради `SubscriptionService` (precondition seed'а
 * `status === 'DEMO'`). RedisService / PrismaService / EventEmitter — глобальные.
 */
@Module({
  imports: [PrismaModule, RbacModule, BillingModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    ConsentService,
    DemoCleanupQueue,
    DemoCleanupWorker,
    SubscriptionActivatedListener,
  ],
  // ConsentService экспортируется для MeModule (Pulse Wave 4 §4.1).
  exports: [OnboardingService, ConsentService],
})
export class OnboardingModule {}
