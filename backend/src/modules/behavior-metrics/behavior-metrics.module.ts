import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { BehaviorMetricsController } from './behavior-metrics.controller';
import { BehaviorMetricsService } from './behavior-metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [BehaviorMetricsController],
  providers: [BehaviorMetricsService],
  exports: [BehaviorMetricsService],
})
export class BehaviorMetricsModule {}
