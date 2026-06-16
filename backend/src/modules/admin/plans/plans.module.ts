import { Module } from '@nestjs/common';

import { BillingModule } from '../../billing/billing.module';
import { AdminSettingsModule } from '../settings/admin-settings.module';

import { AdminPlansController } from './plans.controller';
import { AdminPlansService } from './plans.service';

@Module({
  imports: [BillingModule, AdminSettingsModule],
  controllers: [AdminPlansController],
  providers: [AdminPlansService],
  exports: [AdminPlansService],
})
export class AdminPlansModule {}
