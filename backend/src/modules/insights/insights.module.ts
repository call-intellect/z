import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { InsightsController } from './insights.controller';
import { InsightsService } from './services/insights.service';

@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
