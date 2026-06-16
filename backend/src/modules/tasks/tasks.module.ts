import { Module } from '@nestjs/common';

import { TasksDispatcherService } from './tasks-dispatcher.service';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, TasksDispatcherService],
  exports: [TasksService],
})
export class TasksModule {}
