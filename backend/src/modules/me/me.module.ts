import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { MeController } from './me.controller';
import { MeService } from './me.service';

/**
 * MeModule — `GET /api/v1/me/profile` (Person + Role + Department +
 * RoleProfile в контексте текущей Org).
 */
@Module({
  imports: [PrismaModule],
  controllers: [MeController],
  providers: [MeService],
  exports: [MeService],
})
export class MeModule {}
