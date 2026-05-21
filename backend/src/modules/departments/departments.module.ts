import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './services/departments.service';

/**
 * DepartmentsModule (Фаза 0a — структура компании, группа А).
 *
 * REST API отделов: `/api/v1/departments`.
 *
 * Зависимости (через @Global): PrismaModule, RbacModule, AuthModule,
 * AuditModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}
