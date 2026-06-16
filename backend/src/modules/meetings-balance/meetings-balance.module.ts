import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';

import { MeetingsBalanceController } from './meetings-balance.controller';
import { MeetingsBalanceService } from './meetings-balance.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [MeetingsBalanceController],
  providers: [MeetingsBalanceService],
  exports: [MeetingsBalanceService],
})
export class MeetingsBalanceModule {}
