import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { ProbeDigestCron } from './probe-digest.cron';
import { ProbeDispatcherWorker } from './probe-dispatcher.worker';
import { ProbePriorityCron } from './probe-priority.cron';
import { ProbeResponseHandler } from './probe-response.handler';
import { ProbeController } from './probe.controller';
import { ProbeService } from './probe.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ProbeController],
  providers: [
    ProbeService,
    ProbeDispatcherWorker,
    ProbePriorityCron,
    ProbeDigestCron,
    ProbeResponseHandler,
  ],
  exports: [ProbeService],
})
export class ProbeModule {}
