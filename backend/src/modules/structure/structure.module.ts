import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

/**
 * StructureModule (Фаза 0a.3) — агрегаты + γ-счётчики.
 */
@Module({
  imports: [PrismaModule],
  controllers: [StructureController],
  providers: [StructureService],
  exports: [StructureService],
})
export class StructureModule {}
