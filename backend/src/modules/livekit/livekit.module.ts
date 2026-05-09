import { Global, Module } from '@nestjs/common';

import { LivekitService } from './livekit.service';

/**
 * Глобальный LiveKit-модуль. `LivekitService` нужен в Participants (генерация
 * токенов в `/join`), Webhooks (FSM-переходы), Meetings (host-controls,
 * idle-cron). Поэтому экспортируется глобально.
 */
@Global()
@Module({
  providers: [LivekitService],
  exports: [LivekitService],
})
export class LivekitModule {}
