import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { RetentionExtrasCron } from './retention-extras.cron';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionCron } from './retention.cron';
import { RetentionService } from './retention.service';

@Module({
  controllers: [RetentionPolicyController],
  providers: [
    RetentionService,
    RetentionPolicyService,
    RetentionCron,
    RetentionExtrasCron,
    S3Service,
  ],
  exports: [RetentionService, RetentionPolicyService],
})
export class RetentionModule {}
