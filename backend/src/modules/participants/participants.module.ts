import { Module } from '@nestjs/common';

import { ParticipantsController } from './participants.controller';
import { ParticipantsService } from './participants.service';

/**
 * Participants-модуль.
 * `ParticipantsService` пока используется только в одном контроллере, поэтому
 * не экспортируется глобально. Когда LiveKit-токены подключатся (Фаза 3.2),
 * сервис наполнится зависимостью на `LivekitService` (импортируем явно).
 */
@Module({
  controllers: [ParticipantsController],
  providers: [ParticipantsService],
  exports: [ParticipantsService],
})
export class ParticipantsModule {}
