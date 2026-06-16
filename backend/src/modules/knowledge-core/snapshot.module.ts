import { Module } from '@nestjs/common';

import { KnowledgeSnapshotController } from './api/snapshot.controller';
import { SnapshotService } from './api/snapshot.service';
import { KnowledgeCoreModule } from './knowledge-core.module';

@Module({
  imports: [KnowledgeCoreModule],
  controllers: [KnowledgeSnapshotController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class KnowledgeSnapshotModule {}
