import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { DashboardModule } from '../dashboard/dashboard.module';

import { PersonsController } from './persons.controller';
import { PersonPulseService } from './services/person-pulse.service';
import { PersonsService } from './services/persons.service';

/**
 * PersonsModule (Фаза 0a — структура компании, группа А).
 *
 * REST API сотрудников: `/api/v1/persons`. НЕ путать с
 * `/api/v1/knowledge/entities?type=person` — это разные сущности
 * (Person ↔ Entity линкуются через `Person.entityId`).
 *
 * Pulse Wave 3 §3.4 — `GET /api/v1/persons/:id/pulse` через
 * `PersonPulseService`. Подключаем `DashboardModule` ради
 * `CommitmentReliabilityService` (экспортируется из dashboard).
 */
@Module({
  imports: [PrismaModule, DashboardModule],
  controllers: [PersonsController],
  providers: [PersonsService, PersonPulseService],
  exports: [PersonsService, PersonPulseService],
})
export class PersonsModule {}
