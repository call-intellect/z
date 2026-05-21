import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * `DocumentsModule` (Фаза 0b knowledge-core).
 *
 * Подключает HTTP-эндпоинты `POST /api/v1/documents`, `POST /api/v1/documents/text`,
 * `GET /api/v1/documents[/:id]`, `DELETE /api/v1/documents/:id`.
 *
 * Зависимости из @Global-модулей берутся неявно:
 *   - PrismaModule, RedisModule, CryptoModule, AuthModule, RbacModule.
 *   - IngestModule (`DumpService`) — для делегата текстовых дампов.
 *   - CoreQueueModule (`CoreQueueService`) — для publish `document.uploaded`.
 *
 * `S3Service` локально провайдим (RecordingsModule его экспортирует, но
 * импортировать его сюда — циклы с retention'ом; S3Service stateless).
 */
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, S3Service],
  exports: [DocumentsService],
})
export class DocumentsModule {}
