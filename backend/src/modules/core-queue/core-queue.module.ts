import { Global, Module } from '@nestjs/common';

import { CoreQueueService } from './core-queue.service';
import { WorkerOrgGate } from './worker-org-gate';

@Global()
@Module({
  providers: [CoreQueueService, WorkerOrgGate],
  exports: [CoreQueueService, WorkerOrgGate],
})
export class CoreQueueModule {}
