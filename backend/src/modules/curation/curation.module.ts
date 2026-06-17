import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { CompletenessController } from './completeness.controller';
import { CurationController } from './curation.controller';
import { ConflictService } from './services/conflict.service';
import { CurationService } from './services/curation.service';
import { CuratorRoutingService } from './services/curator-routing.service';
import { CardStaleDetectorCron } from './workers/card-stale-detector.cron';
import {
  CompletenessScannerCron,
  CompletenessScannerService,
} from './workers/completeness-scanner.cron';
import { ConflictArbiterCron } from './workers/conflict-arbiter.cron';
import {
  ConsistencyCheckerCron,
  ConsistencyCheckerService,
} from './workers/consistency-checker.cron';
import { CurationAutotuneCron } from './workers/curation-autotune.cron';
import { CurationItemLifecycleCron } from './workers/curation-item-lifecycle.cron';

@Module({
  imports: [PrismaModule],
  controllers: [CurationController, CompletenessController],
  providers: [
    CurationService,
    ConflictService,
    CuratorRoutingService,
    CardStaleDetectorCron,
    CurationItemLifecycleCron,
    CurationAutotuneCron,
    ConflictArbiterCron,
    CompletenessScannerService,
    CompletenessScannerCron,
    ConsistencyCheckerService,
    ConsistencyCheckerCron,
  ],
  exports: [CurationService, ConflictService, CuratorRoutingService, CompletenessScannerService],
})
export class CurationModule {}
