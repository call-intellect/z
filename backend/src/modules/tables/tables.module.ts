import { Module } from '@nestjs/common';

import { TablePropertiesController } from './controllers/table-properties.controller';
import { TableRowsController } from './controllers/table-rows.controller';
import { TableViewsController } from './controllers/table-views.controller';
import { TablesController } from './controllers/tables.controller';
import { TablePropertiesService } from './services/table-properties.service';
import { TableRowsService } from './services/table-rows.service';
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
  ],
  providers: [
    TablesService,
    TablePropertiesService,
    TableRowsService,
    TableViewsService,
    TablesAutoProvisionService,
  ],
  exports: [TablesService, TablesAutoProvisionService],
})
export class TablesModule {}
