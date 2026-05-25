import { Module } from '@nestjs/common';

import { KnowledgeSnapshotController } from './api/snapshot.controller';
import { SnapshotService } from './api/snapshot.service';
import { KnowledgeCoreModule } from './knowledge-core.module';

/**
 * KC-Temporal W1.3 (2026-05-25) — sub-module для snapshot-API.
 *
 * Выделен отдельным модулем (а не плоской регистрацией в
 * `KnowledgeCoreApiModule`), чтобы минимизировать строку правок в общем
 * `knowledge-core-api.module.ts` и снизить риск merge-конфликтов с
 * параллельными агентами (S2.A: `FactSupersedeService` и т.п.).
 *
 * Зависимости (PrismaService, RbacService, AuthGuard) приходят из глобальных
 * модулей HTTP-приложения; `KnowledgeCoreModule` импортируется для
 * совместимости с возможными внутренними зависимостями (хоть `SnapshotService`
 * сейчас инжектит только `PrismaService` напрямую, держим прозрачный
 * контракт «snapshot работает поверх knowledge-core»).
 */
@Module({
  imports: [KnowledgeCoreModule],
  controllers: [KnowledgeSnapshotController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class KnowledgeSnapshotModule {}
