import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { Specialist33CardHandler } from './services/specialist-3-3-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist33CardHandler],
  exports: [Specialist33CardHandler],
})
export class Specialist33Module {}
