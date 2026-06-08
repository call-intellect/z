import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { ConfluenceClient } from './confluence-client';
import { DocumentImportService } from './document-import.service';
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
  // ТЗ-4 Ф7 — DocumentImportService нужен и контроллеру (createBatch), и
  // DocumentImportWorker (processImport, регистрируется в WorkersModule).
  // Экспортируем его, чтобы WorkersModule мог инжектить через DI.
  providers: [DocumentsService, DocumentImportService, ConfluenceClient, S3Service],
  exports: [DocumentsService, DocumentImportService],
})
export class DocumentsModule {}
