import { Global, Module } from '@nestjs/common';

import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { MeetingsBalanceModule } from '../meetings-balance/meetings-balance.module';
import { MessagingModule } from '../messaging/messaging.module';

import { IdleMeetingCron } from './cron/idle-meeting.cron';
import { HostControlsService } from './host-controls.service';
import { MeetingActionItemsService } from './meeting-action-items.service';
import { MeetingVisibilityService } from './meeting-visibility.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsCrossmarkController } from './meetings.crossmark.controller';
import { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

@Global()
@Module({
  imports: [MeetingsBalanceModule, MessagingModule],
  controllers: [MeetingsController, MeetingsCrossmarkController],
  providers: [
    MeetingsService,
    MeetingsRepository,
    HostControlsService,
    MeetingActionItemsService,
    MeetingVisibilityService,
    IdleMeetingCron,
    IdempotencyInterceptor,
  ],
  exports: [
    MeetingsService,
    MeetingsRepository,
    HostControlsService,
    MeetingActionItemsService,
    MeetingVisibilityService,
  ],
})
export class MeetingsModule {}
