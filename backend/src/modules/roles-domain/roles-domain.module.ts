import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { RolesDomainController } from './roles-domain.controller';
import { RolesDomainService } from './services/roles-domain.service';

@Module({
  imports: [PrismaModule],
  controllers: [RolesDomainController],
  providers: [RolesDomainService],
  exports: [RolesDomainService],
})
export class RolesDomainModule {}
