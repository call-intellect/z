import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { SkillTraitCategoriesController } from './skill-trait-categories.controller';
import { SkillsController } from './skills.controller';
import { SkillTraitCategoryService } from './services/skill-trait-categories.service';
import { SkillsService } from './services/skills.service';

/**
 * SkillsModule.
 *
 *   - `SkillsService` — справочник компетенций Org (Skill).
 *   - `SkillTraitCategoryService` — SBA γ-1 доделки: эмерджентные категории
 *     `SkillTrait` (CRUD + merge). Экспортируется глобально, чтобы
 *     CurationService мог инжектить его без circular import.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SkillsController, SkillTraitCategoriesController],
  providers: [SkillsService, SkillTraitCategoryService],
  exports: [SkillsService, SkillTraitCategoryService],
})
export class SkillsModule {}
