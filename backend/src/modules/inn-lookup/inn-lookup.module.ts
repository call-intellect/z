import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';

import { DadataAdapter } from './adapters/dadata.adapter';
import { MockAdapter } from './adapters/mock.adapter';
import { TochkaOpenBankingAdapter } from './adapters/tochka.adapter';
import { InnLookupController } from './inn-lookup.controller';
import { InnLookupService } from './inn-lookup.service';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [InnLookupController],
  providers: [InnLookupService, MockAdapter, DadataAdapter, TochkaOpenBankingAdapter],
  exports: [InnLookupService],
})
export class InnLookupModule {}
