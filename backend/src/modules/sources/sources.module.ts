import { Module } from '@nestjs/common';

import { IngestEmailModule } from '../ingest/adapters/email/ingest-email.module';

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
 *   - IngestEmailModule — EmailFetchService (smoke-test IMAP).
 */
@Module({
  imports: [IngestEmailModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
