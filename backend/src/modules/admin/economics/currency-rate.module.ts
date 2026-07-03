import { Module } from '@nestjs/common';

import { CurrencyRateService } from './currency-rate.service';

@Module({
  providers: [CurrencyRateService],
  exports: [CurrencyRateService],
})
export class CurrencyRateModule {}
