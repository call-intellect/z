import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { IdeasModule } from '../ideas/ideas.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OperationsModule } from '../operations/operations.module';
import { RoleMapModule } from '../role-map/role-map.module';

import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [PrismaModule, OnboardingModule, RoleMapModule, OperationsModule, IdeasModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
