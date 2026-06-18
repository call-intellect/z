import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { CronManagerController } from './admin-crons.controller';
import { CronManagerService } from './cron-manager.service';

@Module({
  imports: [DiscoveryModule],
  controllers: [CronManagerController],
  providers: [CronManagerService],
  exports: [CronManagerService],
})
export class AdminCronsModule {}
