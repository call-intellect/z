import { Global, Module } from '@nestjs/common';

import { RecordingTrackReconcileCron } from './cron/recording-track-reconcile.cron';
import { LivekitEgressClient } from './livekit-egress.client';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { S3Service } from './s3.service';

@Global()
@Module({
  controllers: [RecordingsController],
  providers: [RecordingsService, S3Service, LivekitEgressClient, RecordingTrackReconcileCron],
  exports: [RecordingsService, S3Service],
})
export class RecordingsModule {}
