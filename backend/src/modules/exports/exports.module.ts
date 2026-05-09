import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { ExportsController } from './exports.controller';
import { ExportsRepository } from './exports.repository';
import { ExportsService } from './exports.service';
import { ExportsWorker } from './exports.worker';
import { BulkZipGenerator } from './generators/bulk-zip.generator';
import { DocxGenerator } from './generators/docx.generator';
import { MdGenerator } from './generators/md.generator';

/**
 * Модуль экспортов. Worker запускается в HTTP-процессе (как и webhook-out)
 * — нагрузка низкая, отдельный процесс не требуется. Если объёмы вырастут —
 * переедет в `WorkersModule`.
 *
 * Не глобальный — наружу выставлен только REST.
 */
@Module({
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExportsRepository,
    ExportsWorker,
    MdGenerator,
    DocxGenerator,
    BulkZipGenerator,
    S3Service,
  ],
  exports: [ExportsService],
})
export class ExportsModule {}
