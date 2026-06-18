import { Global, Module } from '@nestjs/common';

import { PersonsModule } from '../persons/persons.module';

import { MeetingUploadsQueueService } from './meeting-uploads-queue.service';
import { MeetingUploadsController } from './meeting-uploads.controller';
import { MeetingUploadsService } from './meeting-uploads.service';

@Global()
@Module({
  imports: [PersonsModule],
  controllers: [MeetingUploadsController],
  providers: [MeetingUploadsService, MeetingUploadsQueueService],
  exports: [MeetingUploadsService, MeetingUploadsQueueService],
})
export class MeetingUploadsModule {}
