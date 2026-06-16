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
  exports: [OnboardingService, ConsentService],
})
export class OnboardingModule {}
