import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { KnowledgeCloneController } from './knowledge-clone.controller';
import { KnowledgeCloneService } from './services/knowledge-clone.service';

@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [KnowledgeCloneController],
  providers: [KnowledgeCloneService],
  exports: [KnowledgeCloneService],
})
export class KnowledgeCloneModule {}
