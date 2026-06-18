import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CoreQueueModule } from '../core-queue/core-queue.module';

import { RoleMapController } from './role-map.controller';
import { AuthorityBoundaryService } from './services/authority-boundary.service';
import { DecisionPolicyService } from './services/decision-policy.service';
import { InteractionService } from './services/interaction.service';
import { RequiredKnowledgeService } from './services/required-knowledge.service';
import { ResponsibilityElementService } from './services/responsibility-element.service';
import { RoleMapBuilderService } from './services/role-map-builder.service';
import { RoleMapBuilderWorker } from './workers/role-map-builder.worker';
import { RoleMapCompletenessCron } from './workers/role-map-completeness.cron';

@Module({
  imports: [PrismaModule, CoreQueueModule],
  controllers: [RoleMapController],
  providers: [
    ResponsibilityElementService,
    AuthorityBoundaryService,
    RequiredKnowledgeService,
    DecisionPolicyService,
    InteractionService,
    RoleMapBuilderService,
    RoleMapBuilderWorker,
    RoleMapCompletenessCron,
  ],
  exports: [
    ResponsibilityElementService,
    AuthorityBoundaryService,
    RequiredKnowledgeService,
    DecisionPolicyService,
    InteractionService,
    RoleMapBuilderService,
    RoleMapBuilderWorker,
  ],
})
export class RoleMapModule {}
