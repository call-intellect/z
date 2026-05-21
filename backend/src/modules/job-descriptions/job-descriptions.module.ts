import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { JobDescriptionsController } from './job-descriptions.controller';
import { JobDescriptionsService } from './services/job-descriptions.service';

@Module({
  imports: [PrismaModule],
  controllers: [JobDescriptionsController],
  providers: [JobDescriptionsService],
  exports: [JobDescriptionsService],
})
export class JobDescriptionsModule {}
