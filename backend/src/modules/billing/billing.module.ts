import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { AuthModule } from '../auth/auth.module';
import { MeetingsBalanceModule } from '../meetings-balance/meetings-balance.module';
import { RbacModule } from '../rbac/rbac.module';

import { AdminBillingController } from './admin-billing.controller';
import { BillingTochkaOAuthController } from './billing-tochka-oauth.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingController } from './billing.controller';
import { BILLING_PROVIDER } from './billing.types';
import { SubscriptionGuard } from './guards/subscription.guard';
import { ManualBillingProvider } from './providers/manual-billing.provider';
import { TochkaBillingProvider } from './providers/tochka/tochka-billing.provider';
import { TochkaOAuthService } from './providers/tochka/tochka-oauth.service';
import { TochkaWebhookRegistrarService } from './providers/tochka/tochka-webhook-registrar.service';
import { TochkaWebhookVerifierService } from './providers/tochka/tochka-webhook-verifier.service';
import { BillingCycleCron } from './services/billing-cycle.cron';
import { BillingEventService } from './services/billing-event.service';
import { BillingOverviewService } from './services/billing-overview.service';
import { BillingService } from './services/billing.service';
import { InvoiceNumberService } from './services/invoice-number.service';
import { InvoiceStatusSyncCron } from './services/invoice-status-sync.cron';
import { InvoiceService } from './services/invoice.service';
import { ManualBillingService } from './services/manual-billing.service';
import { SeatService } from './services/seat.service';
import { SubscriptionService } from './services/subscription.service';
import { TochkaRecurringChargeCron } from './services/tochka-recurring-charge.cron';

@Module({
  imports: [AuthModule, RbacModule, MeetingsBalanceModule],
  controllers: [
    BillingController,
    AdminBillingController,
    BillingWebhookController,
    BillingTochkaOAuthController,
  ],
  providers: [
    SeatService,
    InvoiceNumberService,

    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,
    BillingOverviewService,

    TochkaOAuthService,
    TochkaWebhookVerifierService,
    TochkaWebhookRegistrarService,
    TochkaBillingProvider,

    ManualBillingProvider,

    {
      provide: BILLING_PROVIDER,
      inject: [ManualBillingProvider, TochkaBillingProvider, TypedConfigService],
      useFactory: (
        manual: ManualBillingProvider,
        tochka: TochkaBillingProvider,
        cfg: TypedConfigService,
      ) => {
        const wantsTochka = cfg.billing.provider === 'tochka' && cfg.billing.features.tochka;
        return wantsTochka ? tochka : manual;
      },
    },

    BillingService,

    SubscriptionGuard,

    BillingCycleCron,
    TochkaRecurringChargeCron,
    InvoiceStatusSyncCron,
  ],
  exports: [
    SeatService,
    InvoiceNumberService,
    SubscriptionService,
    InvoiceService,
    BillingEventService,
    ManualBillingService,
    BillingService,
    BILLING_PROVIDER,
    SubscriptionGuard,
    TochkaOAuthService,
  ],
})
export class BillingModule implements OnApplicationBootstrap {
  constructor(
    private readonly cfg: TypedConfigService,
    private readonly oauth: TochkaOAuthService,
    private readonly registrar: TochkaWebhookRegistrarService,
    private readonly tochka: TochkaBillingProvider,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.billing.features.tochka) return;
    if (this.cfg.billing.provider !== 'tochka') return;

    await this.oauth.ensureOAuthReady().catch(() => {});

    if (this.cfg.billing.tochka.webhookAutoRegister) {
      setTimeout(() => {
        void this.registrar.registerOnce(this.tochka);
      }, 1500);
    }
  }
}
