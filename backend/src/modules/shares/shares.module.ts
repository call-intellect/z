import { Module } from '@nestjs/common';

import { PublicShareController } from './public-share.controller';
import { PublicShareHeadersInterceptor } from './public-share-headers.interceptor';
import { SharesController } from './shares.controller';
import { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';

/**
 * `S3Service` — глобальный (RecordingsModule), `AuditLogService` — глобальный
 * (AuditModule, M3c). Здесь регистрируем приватный (Cookie) и публичный
 * (без auth) контроллеры.
 *
 * `PublicShareHeadersInterceptor` — provider, потому что подключается через
 * `@UseInterceptors(...)` на классе `PublicShareController` и должен быть
 * инстанцирован через DI.
 */
@Module({
  controllers: [SharesController, PublicShareController],
  providers: [SharesService, SharesRepository, PublicShareHeadersInterceptor],
  exports: [SharesService],
})
export class SharesModule {}
