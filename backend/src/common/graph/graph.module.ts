import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { GraphService } from './graph.service';

/**
 * Глобальный модуль графовой инфраструктуры (Фаза 0a, см. план
 * `plans/tz/2026-05-21-phase-0a-data-model-and-graph-infra.md` §6).
 *
 * Экспортирует `GraphService` — единую точку работы с PostgreSQL EntityLink
 * (Postgres) + Apache AGE (`z_graph`). `@Global()` чтобы был доступен везде
 * без явного импорта в feature-модулях.
 *
 * Прямое обращение к `cypher(...)` из бизнес-сервисов запрещено — см.
 * `second-brain/02_architecture/code-pitfalls.md` («Cypher только через
 * GraphService»).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
