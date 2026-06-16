import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { SkillTraitCategoryService } from './services/skill-trait-categories.service';
import { SkillsService } from './services/skills.service';
import { SkillTraitCategoriesController } from './skill-trait-categories.controller';
import { SkillsController } from './skills.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SkillsController, SkillTraitCategoriesController],
  providers: [SkillsService, SkillTraitCategoryService],
  exports: [SkillsService, SkillTraitCategoryService],
})
export class SkillsModule {}
