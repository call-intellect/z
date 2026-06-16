import { Module } from '@nestjs/common';

import { AdminSmokeTestController } from './smoke-test.controller';
import { AdminSmokeTestService } from './smoke-test.service';

@Module({
  controllers: [AdminSmokeTestController],
  providers: [AdminSmokeTestService],
  exports: [AdminSmokeTestService],
})
export class AdminAiModule {}
