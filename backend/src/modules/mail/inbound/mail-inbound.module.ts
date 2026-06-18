import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../common/prisma/prisma.module';
import { RecordingsModule } from '../../recordings/recordings.module';
import { TrackerModule } from '../../tracker/tracker.module';

import { ImapPollCron } from './imap-poll.cron';
import { ProjectEmailInboxController } from './project-email-inbox.controller';
import { ProjectEmailInboxService } from './project-email-inbox.service';
import { ProjectInboxService } from './project-inbox.service';

@Module({
  imports: [PrismaModule, TrackerModule, RecordingsModule],
  controllers: [ProjectEmailInboxController],
  providers: [ProjectInboxService, ProjectEmailInboxService, ImapPollCron],
})
export class MailInboundModule {}
