import { Global, Module } from '@nestjs/common';

import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';
import { MeetingsBalanceModule } from '../meetings-balance/meetings-balance.module';

import { IdleMeetingCron } from './cron/idle-meeting.cron';
import { HostControlsService } from './host-controls.service';
import { MeetingActionItemsService } from './meeting-action-items.service';
import { MeetingTaskDedupeService } from './meeting-task-dedupe.service';
import { MeetingVisibilityService } from './meeting-visibility.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsCrossmarkController } from './meetings.crossmark.controller';
import { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

/**
 * Глобальный Meetings-модуль. `MeetingsService` нужен в Webhooks, Recordings,
 * AI-pipeline — поэтому экспортирован.
 *
 * `IdempotencyInterceptor` объявлен как provider (не глобально), чтобы
 * `@UseInterceptors(IdempotencyInterceptor)` мог его инстанцировать через DI.
 *
 * `HostControlsService` — mute/kick/finish/lower-hand для хоста (Фаза 3.4–3.5).
 * `IdleMeetingCron` — раз в минуту проходит по active-встречам и закрывает
 * пустые room'ы (Фаза 3.6).
 */
@Global()
@Module({
  imports: [MeetingsBalanceModule],
  controllers: [MeetingsController, MeetingsCrossmarkController],
  providers: [
    MeetingsService,
    MeetingsRepository,
    HostControlsService,
    MeetingActionItemsService,
    MeetingTaskDedupeService,
    MeetingVisibilityService,
    IdleMeetingCron,
    IdempotencyInterceptor,
  ],
  exports: [
    MeetingsService,
    MeetingsRepository,
    HostControlsService,
    MeetingActionItemsService,
    MeetingTaskDedupeService,
    MeetingVisibilityService,
  ],
})
export class MeetingsModule {}
