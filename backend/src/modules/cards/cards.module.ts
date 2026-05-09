import { Module } from '@nestjs/common';

import { CardsController } from './cards.controller';
import { CardsRepository } from './cards.repository';
import { CardsService } from './cards.service';

/**
 * Модуль карточек (CRM-структура встреч). Зависит от глобальных:
 *   - PrismaModule, AuthModule, ConfigModule, AuditModule (M3c).
 *
 * Экспортирует `CardsService` для других модулей (search endpoint в Cmd+K
 * палитре, AI-чат по карточке, public-api).
 *
 * Триггер AI-rollup после link/unlink подключается извне через
 * `CardsService.setLinkTrigger(...)` (см. card-rollup.service в AI-модуле,
 * Фаза 5). Это позволяет не создавать жёсткой циклической зависимости
 * cards ↔ ai.
 */
@Module({
  controllers: [CardsController],
  providers: [CardsService, CardsRepository],
  exports: [CardsService],
})
export class CardsModule {}
