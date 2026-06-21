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
  ],
  exports: [ProbeService, ProbeFormulationService],
})
export class ProbeModule {}
