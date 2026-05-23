import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './services/appointments.service';

/**
 * SBA α-8 wave 3 — AppointmentsModule.
 *
 * Replacement для PersonRole: модель `Appointment` + REST CRUD + timeline.
 * PersonsService через feature-flag `USE_APPOINTMENT_FOR_PERSON_ROLES`
 * читает Appointment вместо PersonRole; PersonRole сохраняется для
 * backward-compat и удаляется отдельным sub-ТЗ через 1 месяц после
 * прод-миграции.
 *
 * Зависимости:
 *   - @Global Prisma, Rbac, Auth, Metrics.
 *   - Audit (для журналирования create/update/archive).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
