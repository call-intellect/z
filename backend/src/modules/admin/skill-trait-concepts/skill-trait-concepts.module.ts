import { Module } from '@nestjs/common';

import { AdminSkillTraitConceptsService } from './services/skill-trait-concepts.service';
import { AdminSkillTraitConceptsController } from './skill-trait-concepts.controller';

@Module({
  controllers: [AdminSkillTraitConceptsController],
  providers: [AdminSkillTraitConceptsService],
  exports: [AdminSkillTraitConceptsService],
})
export class AdminSkillTraitConceptsModule {}
