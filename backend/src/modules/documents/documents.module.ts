import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { ConfluenceClient } from './confluence-client';
import { DocumentAttributionService } from './document-attribution.service';
import { DocumentImportService } from './document-import.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentImportService,
    DocumentAttributionService,
    ConfluenceClient,
    S3Service,
  ],
  exports: [DocumentsService, DocumentImportService, DocumentAttributionService],
})
export class DocumentsModule {}
