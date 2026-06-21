import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

import { ProbeDigestCron } from './probe-digest.cron';
import { ProbeDispatcherWorker } from './probe-dispatcher.worker';
import { ProbeFormulationService } from './probe-formulation.service';
import { ProbePriorityCron } from './probe-priority.cron';
import { ProbeResponseHandler } from './probe-response.handler';
import { ProbeController } from './probe.controller';
import { ProbeService } from './probe.service';
import { SubjectMemoryActivationCron } from './subject-memory/subject-memory-activation.cron';
import { SubjectMemoryActivationService } from './subject-memory/subject-memory-activation.service';
import { SubjectMemoryDeriveWorker } from './subject-memory/subject-memory-derive.worker';
import { SubjectMemoryService } from './subject-memory/subject-memory.service';

@Global()
@Module({
  imports: [PrismaModule, EmbeddingsModule, CurationModule],
  controllers: [ProbeController],
  providers: [
    ProbeService,
    ProbeFormulationService,
    ProbeDispatcherWorker,
    ProbePriorityCron,
    ProbeDigestCron,
    ProbeResponseHandler,
    SubjectMemoryService,
    SubjectMemoryDeriveWorker,
    SubjectMemoryActivationService,
    SubjectMemoryActivationCron,
  ],
  exports: [ProbeService, ProbeFormulationService, SubjectMemoryService],
})
export class ProbeModule {}
