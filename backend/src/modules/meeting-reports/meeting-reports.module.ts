import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { MeetingReportsController } from './meeting-reports.controller';
import { MeetingReportsService } from './meeting-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [MeetingReportsController],
  providers: [MeetingReportsService],
  exports: [MeetingReportsService],
})
export class MeetingReportsModule {}
