import { Module } from '@nestjs/common';

import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Глобальный поиск (Cmd+K командная палитра).
 *
 * Реализация — простой ILIKE по relevant-полям. Не зависит от других модулей.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
