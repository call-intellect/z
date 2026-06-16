import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { IdeasController } from './ideas.controller';
import { IdeasService } from './services/ideas.service';

@Module({
  imports: [PrismaModule],
  controllers: [IdeasController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
