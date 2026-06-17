import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { KpiController } from './kpi.controller';
import { KpiService } from './services/kpi.service';

@Module({
  imports: [PrismaModule],
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
