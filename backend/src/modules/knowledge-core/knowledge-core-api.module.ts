import { Module } from '@nestjs/common';

import { TrackerModule } from '../tracker/tracker.module';

import { KnowledgeBlocksController } from './api/blocks.controller';
import { KnowledgeBranchesController } from './api/branches.controller';
import { KnowledgeEntitiesController } from './api/entities.controller';
import { KnowledgeGraphController } from './api/graph.controller';
import { ProvenanceController } from './api/provenance.controller';
import { KnowledgeSearchController } from './api/search.controller';
import { SprintReviewController } from './api/sprint-review.controller';
import { KnowledgeThemesController } from './api/themes.controller';
import { GraphDiagnosticsController } from './controllers/graph-diagnostics.controller';
import { KnowledgeCoreModule } from './knowledge-core.module';
import { KnowledgeSnapshotModule } from './snapshot.module';

@Module({
  imports: [KnowledgeCoreModule, KnowledgeSnapshotModule, TrackerModule],
  controllers: [
    KnowledgeSearchController,
    KnowledgeBlocksController,
    KnowledgeBranchesController,
    KnowledgeEntitiesController,
    KnowledgeGraphController,
    KnowledgeThemesController,
    SprintReviewController,
    GraphDiagnosticsController,
    ProvenanceController,
  ],
})
export class KnowledgeCoreApiModule {}
