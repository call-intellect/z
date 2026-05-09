import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Глобальный Prisma-модуль. `PrismaService` доступен везде через DI.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
