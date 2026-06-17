import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { KnowledgeAccessAdminController } from './knowledge-access-admin.controller';
import { KnowledgeAccessAdminService } from './knowledge-access-admin.service';

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeAccessAdminController],
  providers: [KnowledgeAccessAdminService],
})
export class KnowledgeAccessModule {}
