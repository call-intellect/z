import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PersonsController } from './persons.controller';
import { PersonsService } from './services/persons.service';

/**
 * PersonsModule (Фаза 0a — структура компании, группа А).
 *
 * REST API сотрудников: `/api/v1/persons`. НЕ путать с
 * `/api/v1/knowledge/entities?type=person` — это разные сущности
 * (Person ↔ Entity линкуются через `Person.entityId`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PersonsController],
  providers: [PersonsService],
  exports: [PersonsService],
})
export class PersonsModule {}
