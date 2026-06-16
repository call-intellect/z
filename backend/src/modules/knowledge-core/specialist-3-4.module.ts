import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist34CardHandler } from './services/specialist-3-4-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist34CardHandler],
  exports: [Specialist34CardHandler],
})
export class Specialist34Module {}
