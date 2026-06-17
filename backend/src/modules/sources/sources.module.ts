import { Module } from '@nestjs/common';

import { IngestEmailModule } from '../ingest/adapters/email/ingest-email.module';

import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  imports: [IngestEmailModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
