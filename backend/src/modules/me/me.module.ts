import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

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
 */
@Module({
  imports: [PrismaModule, OnboardingModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
