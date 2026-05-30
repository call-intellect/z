import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { ConsentService } from './services/consent.service';

@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, ConsentService],
  // ConsentService экспортируется для MeModule (Pulse Wave 4 §4.1).
  exports: [OnboardingService, ConsentService],
})
export class OnboardingModule {}
