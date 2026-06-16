import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist32CardHandler } from './services/specialist-3-2-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist32CardHandler],
  exports: [Specialist32CardHandler],
})
export class Specialist32Module {}
