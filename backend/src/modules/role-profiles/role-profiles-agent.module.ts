import { Module } from '@nestjs/common';

import { CoreQueueModule } from '../core-queue/core-queue.module';
import { RoleProfileCron } from '../knowledge-core/workers/role-profile.cron';
import { RoleProfileWorker } from '../knowledge-core/workers/role-profile.worker';

import { RoleProfileContextBuilder } from './services/context-builder.service';
import { RoleProfileService } from './services/role-profile.service';

@Module({
  imports: [CoreQueueModule],
  providers: [RoleProfileService, RoleProfileContextBuilder, RoleProfileWorker, RoleProfileCron],
  exports: [RoleProfileService],
})
export class RoleProfilesAgentModule {}
