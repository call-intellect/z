import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { TaskSolutionsService } from './services/task-solutions.service';
import { TaskSolutionsController } from './task-solutions.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TaskSolutionsController],
  providers: [TaskSolutionsService],
  exports: [TaskSolutionsService],
})
export class TaskSolutionsModule {}
