import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { ExperimentsController } from './experiments.controller';
import { ExperimentsService } from './services/experiments.service';

/**
 * ExperimentsModule (SBA β-6).
 *
 * REST API `/api/v1/experiments` — институциональная память «что попробовали
 * и что вышло». Под капотом — Prisma-модели `Experiment` + `ExperimentVersion`
 * (β-6 §5).
 *
 * Зависимости:
 *   - PrismaModule — модели Experiment / ExperimentVersion.
 *   - RbacModule (Global) — для requireRead / requireWrite в контроллере.
 *
 * Все user-facing строки на русском. RBAC — `experiment` ResourceType
 * (см. policy.csv).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
