import { Module } from '@nestjs/common';

import { KnowledgeBlocksController } from './api/blocks.controller';
import { KnowledgeEntitiesController } from './api/entities.controller';
import { KnowledgeGraphController } from './api/graph.controller';
import { KnowledgeSearchController } from './api/search.controller';
import { KnowledgeThemesController } from './api/themes.controller';
import { KnowledgeCoreModule } from './knowledge-core.module';
import { KnowledgeSnapshotModule } from './snapshot.module';

/**
 * HTTP-слой knowledge-core: только контроллеры (поиск/блоки/сущности/граф/темы).
 *
 * Вынесен из `KnowledgeCoreModule` (сервисы, @Global), чтобы worker-процесс мог
 * импортировать сервисы без HTTP-контроллеров и их guard'ов. Сервисы контроллеры
 * получают из @Global `KnowledgeCoreModule`; auth-guard'ы (CookieAuthGuard/TenantGuard)
 * — из глобальных модулей HTTP-приложения.
 *
 * Импортируется только в `app.module` (HTTP).
 *
 * KC-Temporal W1.3 (2026-05-25): `KnowledgeSnapshotModule` отдельным
 * под-модулем, чтобы изолировать snapshot-контроллер/сервис от потенциальных
 * merge-конфликтов с параллельными агентами.
 */
@Module({
  imports: [KnowledgeCoreModule, KnowledgeSnapshotModule],
  controllers: [
    KnowledgeSearchController,
    KnowledgeBlocksController,
    KnowledgeEntitiesController,
    KnowledgeGraphController,
    KnowledgeThemesController,
  ],
})
export class KnowledgeCoreApiModule {}
