import { Module } from '@nestjs/common';

import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

/**
 * SourcesModule — управление источниками Org (Фаза 10 knowledge-core).
 *
 * Зависит от:
 *   - PrismaModule (@Global)
 *   - CryptoModule (@Global) — для шифрования секретов в Source.config.
 *   - AuditModule (@Global) — AuditLogService.
 *   - RbacModule (@Global) — RbacService.
 *   - IngestModule (@Global) — экспортирует TelegramAdapterService и др.
 *
 * Всё перечисленное — глобальные модули; здесь ничего импортировать не нужно.
 */
@Module({
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
