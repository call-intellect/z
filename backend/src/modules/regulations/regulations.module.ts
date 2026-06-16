import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { RegulationsController } from './regulations.controller';
import { RegulationsService } from './services/regulations.service';

@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [RegulationsController],
  providers: [RegulationsService],
  exports: [RegulationsService],
})
export class RegulationsModule {}
