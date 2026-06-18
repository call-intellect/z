import { Module } from '@nestjs/common';

import { CrossmarkResultController } from './crossmark-result.controller';
import { CrossmarkResultService } from './crossmark-result.service';
import { CrossmarkUsageService } from './crossmark-usage.service';

@Module({
  controllers: [CrossmarkResultController],
  providers: [CrossmarkResultService, CrossmarkUsageService],
  exports: [CrossmarkResultService, CrossmarkUsageService],
})
export class CrossmarkModule {}
