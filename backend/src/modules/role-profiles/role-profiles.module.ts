import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CoreQueueModule } from '../core-queue/core-queue.module';

import { RoleProfilesController } from './role-profiles.controller';
import { RoleProfilesService } from './services/role-profiles.service';

@Module({
  imports: [PrismaModule, CoreQueueModule],
  controllers: [RoleProfilesController],
  providers: [RoleProfilesService],
  exports: [RoleProfilesService],
})
export class RoleProfilesModule {}
