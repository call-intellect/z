import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './services/decisions.service';

@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [DecisionsController],
  providers: [DecisionsService],
  exports: [DecisionsService],
})
export class DecisionsModule {}
