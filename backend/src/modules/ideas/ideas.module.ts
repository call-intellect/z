import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { IdeasController } from './ideas.controller';
import { IdeasService } from './services/ideas.service';

/**
 * IdeasModule (SBA β-5).
 *
 * REST API `/api/v1/ideas` — Ideas Collector + IdeaCluster + me/ideas.
 * Под капотом — Specialist36Service (changeStatus + EventEmitter
 * 'idea.status_changed' → closing-loop) и Prisma-таблицы `ideas` / `idea_clusters`.
 *
 * Зависимости (через @Global модули):
 *   - Specialist36Service из KnowledgeCoreModule (@Global).
 *   - RbacService — Global.
 */
@Module({
  imports: [PrismaModule],
  controllers: [IdeasController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
