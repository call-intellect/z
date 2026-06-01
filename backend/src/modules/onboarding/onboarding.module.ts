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
import { DemoSeedQueue } from './workers/demo-seed.queue';
import { DemoSeedWorker } from './workers/demo-seed.worker';

/**
 * OnboardingModule.
 *
 * ТЗ 2026-05-31-demo-auto-seed-and-cleanup: авто-заливка демо-кабинета при
 * регистрации (очередь `onboarding.demo-seed`) + авто-стирание при первой
 * оплате (очередь `onboarding.demo-cleanup`, слушает billing-события).
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
    DemoSeedQueue,
    DemoSeedWorker,
    DemoCleanupQueue,
    DemoCleanupWorker,
    SubscriptionActivatedListener,
  ],
  // ConsentService экспортируется для MeModule (Pulse Wave 4 §4.1).
  exports: [OnboardingService, ConsentService],
})
export class OnboardingModule {}
