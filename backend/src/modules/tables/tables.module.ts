import { Module } from '@nestjs/common';

import { PendingPatchesController } from './controllers/pending-patches.controller';
import { TablePropertiesController } from './controllers/table-properties.controller';
import { TableRowsController } from './controllers/table-rows.controller';
import { TableViewsController } from './controllers/table-views.controller';
import { TablesController } from './controllers/tables.controller';
import { TableEnrichListener } from './listeners/table-enrich.listener';
import { TableSyncListener } from './listeners/table-sync.listener';
import { TableAgentService } from './services/table-agent.service';
import { TableEnrichQueueService } from './services/table-enrich-queue.service';
import { TableEnrichService } from './services/table-enrich.service';
import { TableFileParserService } from './services/table-file-parser.service';
import { TableGraphSyncService } from './services/table-graph-sync.service';
import { TableImportService } from './services/table-import.service';
import { TablePropertiesService } from './services/table-properties.service';
import { TableRowsService } from './services/table-rows.service';
import { TableSemanticFilterService } from './services/table-semantic-filter.service';
import { TableSyncQueueService } from './services/table-sync-queue.service';
import { TableSyncService } from './services/table-sync.service';
import { TableViewsService } from './services/table-views.service';
import { TablesAutoProvisionService } from './services/tables-auto-provision.service';
import { TablesService } from './services/tables.service';

@Module({
  controllers: [
    PendingPatchesController,
    TablesController,
    TablePropertiesController,
    TableRowsController,
    TableViewsController,
  ],
  providers: [
    TablesService,
    TablePropertiesService,
    TableRowsService,
    TableViewsService,
    TablesAutoProvisionService,
    TableAgentService,
    TableSemanticFilterService,
    TableFileParserService,
    TableImportService,
    TableSyncQueueService,
    TableSyncService,
    TableSyncListener,
    TableEnrichQueueService,
    TableEnrichService,
    TableEnrichListener,
    TableGraphSyncService,
  ],
  exports: [
    TablesService,
    TablesAutoProvisionService,
    TableAgentService,
    TableSemanticFilterService,
    TableSyncService,
    TableSyncQueueService,
    TableEnrichService,
    TableEnrichQueueService,
    TableGraphSyncService,
  ],
})
export class TablesModule {}
