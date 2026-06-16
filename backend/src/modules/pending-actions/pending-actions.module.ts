import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';
import { TrackerModule } from '../tracker/tracker.module';

import { PendingActionsController } from './pending-actions.controller';
import { ConflictPendingProvider } from './providers/conflict.provider';
import { CurationPendingProvider } from './providers/curation.provider';
import { IntakePendingProvider } from './providers/intake.provider';
import { ProbePendingProvider } from './providers/probe.provider';
import { PendingActionsService } from './services/pending-actions.service';
import { PendingActionsReminderCron } from './workers/pending-actions-reminder.cron';

@Module({
  imports: [PrismaModule, CurationModule, TrackerModule],
  controllers: [PendingActionsController],
  providers: [
    PendingActionsService,
    CurationPendingProvider,
    ConflictPendingProvider,
    IntakePendingProvider,
    ProbePendingProvider,
    PendingActionsReminderCron,
  ],
  exports: [PendingActionsService],
})
export class PendingActionsModule {}
