import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { GoalsController } from './goals.controller';
import { GoalsService } from './services/goals.service';

/**
 * GoalsModule (Фаза 9 knowledge-core).
 *
 * REST API целей компании + сервис CRUD/тем. Воркер `strategic-alignment`
 * (Шаг 4 Фазы 9) живёт в `WorkersModule` и читает таблицу `Goal` напрямую
 * через PrismaService.
 *
 * Зависимости (через @Global):
 *   - PrismaModule, AuthModule, RbacModule, AuditModule.
 *   - CoreQueueModule (через global) — для шага 5 (`/recompute` enqueue).
 */
@Module({
  imports: [PrismaModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
