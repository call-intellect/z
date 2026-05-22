import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { KnowledgeCloneController } from './knowledge-clone.controller';
import { KnowledgeCloneService } from './services/knowledge-clone.service';

/**
 * SBA β-2 — REST API модуль «Профиля знаний» (Knowledge Clone).
 *
 *   GET  /api/v1/me/knowledge-profile
 *   GET  /api/v1/persons/:id/knowledge-profile
 *   POST /api/v1/me/knowledge-profile/mark-wrong
 *
 * Зависимости:
 *   - PrismaModule (читаем Person.knowledgeProfile);
 *   - CurationModule (markWrong создаёт CurationItem level='deep' через triage).
 *
 * Регистрируется в `AppModule` ПОСЛЕ `CurationModule` (использует
 * `CurationService.triage`).
 */
@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [KnowledgeCloneController],
  providers: [KnowledgeCloneService],
  exports: [KnowledgeCloneService],
})
export class KnowledgeCloneModule {}
