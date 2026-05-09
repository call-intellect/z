import { Global, Module } from '@nestjs/common';

import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

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
 */
@Global()
@Module({
  controllers: [MeetingsController, MeetingsCrossmarkController],
  providers: [MeetingsService, MeetingsRepository, IdempotencyInterceptor],
  exports: [MeetingsService, MeetingsRepository],
})
export class MeetingsModule {}
