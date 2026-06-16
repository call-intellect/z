import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';

import { KnowledgeAccessLoggerInterceptor } from './interceptors/knowledge-access-logger.interceptor';
import { PersonsController } from './persons.controller';
import { PersonPulseService } from './services/person-pulse.service';
import { PersonsService } from './services/persons.service';

@Module({
  imports: [PrismaModule, DashboardModule],
  controllers: [PersonsController],
  providers: [PersonsService, PersonPulseService, KnowledgeAccessLoggerInterceptor],
  exports: [PersonsService, PersonPulseService],
})
export class PersonsModule {}
