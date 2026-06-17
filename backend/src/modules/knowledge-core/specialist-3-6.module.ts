import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatV2Module } from '../chat-v2/chat-v2.module';

import { IdeaStatusAutoAdvanceService } from './services/idea-status-auto-advance.service';
import { IdeasClosingLoopHandler } from './services/ideas-closing-loop.handler';
import { Specialist36CardHandler } from './services/specialist-3-6-card-handler.service';

@Module({
  imports: [PrismaModule, ChatV2Module],
  providers: [Specialist36CardHandler, IdeasClosingLoopHandler, IdeaStatusAutoAdvanceService],
  exports: [Specialist36CardHandler],
})
export class Specialist36Module {}
