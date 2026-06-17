import { Module } from '@nestjs/common';

import { CoreQueueModule } from '../../../core-queue/core-queue.module';
import { S3Service } from '../../../recordings/s3.service';

import { EmailFetchCron } from './email-fetch.cron';
import { EmailFetchService } from './email-fetch.service';

@Module({
  imports: [CoreQueueModule],
  providers: [EmailFetchService, EmailFetchCron, S3Service],
  exports: [EmailFetchService],
})
export class IngestEmailModule {}
