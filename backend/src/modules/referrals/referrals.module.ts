import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InnLookupModule } from '../inn-lookup/inn-lookup.module';

import { AdminReferralsController } from './controllers/admin-referrals.controller';
import { PublicReferralsController } from './controllers/public-referrals.controller';
import { ReferralsController } from './controllers/referrals.controller';
import { AttributionService } from './services/attribution.service';
import { ReferralPayoutService } from './services/referral-payout.service';
import { ReferralsService } from './services/referrals.service';

@Module({
  imports: [AuthModule, InnLookupModule, BillingModule],
  controllers: [PublicReferralsController, ReferralsController, AdminReferralsController],
  providers: [ReferralsService, AttributionService, ReferralPayoutService],
  exports: [ReferralsService, AttributionService, ReferralPayoutService],
})
export class ReferralsModule {}
