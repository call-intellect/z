import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist31CardHandler } from './services/specialist-3-1-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist31CardHandler],
  exports: [Specialist31CardHandler],
})
export class Specialist31Module {}
