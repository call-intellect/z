import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RoleMapModule } from '../role-map/role-map.module';

import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * MeModule — `GET /api/v1/me/profile` (Person + Role + Department +
 * RoleProfile в контексте текущей Org).
 *
 * Pulse Wave 4 §4.1-4.2 — добавлены compliance-endpoints
 * `/me/consents` и `/me/privacy/access-log` (см. `MeController`).
 * `ConsentService` приходит из `OnboardingModule`; `IpHashingService` —
 * из глобального `SecurityModule` (@Global).
 *
 * `RoleMapModule` импортируется ради `RoleMapBuilderService` — MeService
 * собирает полную карту должности пользователя для `/me` (self-scoped, без
 * RBAC role-profile; RBAC карты живёт в RoleMapController). Цикла нет:
 * RoleMapModule не зависит от MeModule.
 */
@Module({
  imports: [PrismaModule, OnboardingModule, RoleMapModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
