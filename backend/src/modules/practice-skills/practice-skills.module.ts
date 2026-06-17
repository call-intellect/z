import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AdminPracticeSkillsController } from './controllers/admin-practice-skills.controller';
import { PracticeSkillEvaluatorService } from './services/practice-skill-evaluator.service';
import { PracticeSkillExtractorService } from './services/practice-skill-extractor.service';
import { PracticeSkillRetrievalService } from './services/practice-skill-retrieval.service';
import { PracticeSkillEvaluateCron } from './workers/practice-skill-evaluate.cron';
import { PracticeSkillExtractWorker } from './workers/practice-skill-extract.worker';

@Module({
  imports: [PrismaModule],
  controllers: [AdminPracticeSkillsController],
  providers: [
    PracticeSkillExtractorService,
    PracticeSkillRetrievalService,
    PracticeSkillEvaluatorService,
    PracticeSkillExtractWorker,
    PracticeSkillEvaluateCron,
  ],
  exports: [PracticeSkillRetrievalService],
})
export class PracticeSkillsModule {}
