import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { ExportsController } from './exports.controller';
import { ExportsRepository } from './exports.repository';
import { ExportsService } from './exports.service';
import { ExportsWorker } from './exports.worker';
import { BulkZipGenerator } from './generators/bulk-zip.generator';
import { DocxGenerator } from './generators/docx.generator';
import { MdGenerator } from './generators/md.generator';

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
