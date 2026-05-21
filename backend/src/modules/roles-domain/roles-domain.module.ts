import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { RolesDomainController } from './roles-domain.controller';
import { RolesDomainService } from './services/roles-domain.service';

/**
 * RolesDomainModule (Фаза 0a — структура компании, группа А).
 *
 * REST API бизнес-должностей: `/api/v1/roles`. Не путать с
 * `MembershipRole` (owner/admin/manager) — это бизнес-сущность Role
 * (должность в компании клиента).
 */
@Module({
  imports: [PrismaModule],
  controllers: [RolesDomainController],
  providers: [RolesDomainService],
  exports: [RolesDomainService],
})
export class RolesDomainModule {}
