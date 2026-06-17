import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist35CardHandler } from './services/specialist-3-5-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist35CardHandler],
  exports: [Specialist35CardHandler],
})
export class Specialist35Module {}
