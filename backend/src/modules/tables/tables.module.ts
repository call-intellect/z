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
import { TablePropertiesService } from './services/table-properties.service';
import { TableRowsService } from './services/table-rows.service';
import { TableSyncQueueService } from './services/table-sync-queue.service';
import { TableSyncService } from './services/table-sync.service';
import { TableViewsService } from './services/table-views.service';
import { TablesAutoProvisionService } from './services/tables-auto-provision.service';
import { TablesService } from './services/tables.service';

/**
 * Smart Tables (см. plans/tz/2026-05-31-smart-tables.md Фазы 0–3).
 *
 * Подключает четыре HTTP-контроллера:
 *   - `POST/GET/PATCH/DELETE /api/v1/tables[/:id[/archive|unarchive]]`
 *   - `GET/POST/PATCH/DELETE /api/v1/tables/:tableId/properties/...`
 *   - `GET/POST/PATCH/DELETE /api/v1/tables/:tableId/rows/...`
 *   - `GET/POST/PATCH/DELETE /api/v1/tables/:tableId/views/...`        (Фаза 3)
 *
 * Все зависимости (`PrismaService`, `RbacService`, `TypedConfigService`,
 * `CookieAuthGuard`) берутся неявно из @Global-модулей (PrismaModule /
 * RbacModule / ConfigModule / AuthModule).
 *
 * Automations / AI / Public forms — отдельные фазы, в этот модуль добавятся
 * постепенно (Фаза 4+).
 */
@Module({
  controllers: [
    TablesController,
    TablePropertiesController,
    TableRowsController,
    TableViewsController,
    // Smart-tables Фаза 3 — Event-to-Cells: очередь подтверждений + провенанс.
    PendingPatchesController,
  ],
  providers: [
    TablesService,
    TablePropertiesService,
    TableRowsService,
    TableViewsService,
    TablesAutoProvisionService,
    TableAgentService,
    // Smart-tables Фаза 2 — live entitySync. Listener слушает события графа и
    // кладёт job в `tables.sync`; сам воркер живёт в WorkersModule (in-process).
    TableSyncQueueService,
    TableSyncService,
    TableSyncListener,
    // Smart-tables Фаза 3 — Event-to-Cells. Listener слушает `meeting.ai_ready`
    // и кладёт job в `tables.enrich`; воркер живёт в WorkersModule (in-process).
    TableEnrichQueueService,
    TableEnrichService,
    TableEnrichListener,
  ],
  exports: [
    TablesService,
    TablesAutoProvisionService,
    TableAgentService,
    // Экспортируем для WorkersModule (TableSyncWorker) и для backfill-сценариев.
    TableSyncService,
    TableSyncQueueService,
    // Экспортируем для WorkersModule (TableEnrichWorker).
    TableEnrichService,
    TableEnrichQueueService,
  ],
})
export class TablesModule {}
