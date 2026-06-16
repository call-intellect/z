import { Global, Module } from '@nestjs/common';

import { QuotasModule } from '../quotas/quotas.module';
import { RbacModule } from '../rbac/rbac.module';

import { AiChatQuotaController } from './ai-chat-quota.controller';
import { AiChatQuotaService } from './ai-chat-quota.service';

@Global()
@Module({
  imports: [QuotasModule, RbacModule],
  controllers: [AiChatQuotaController],
  providers: [AiChatQuotaService],
  exports: [AiChatQuotaService],
})
export class AiChatQuotaModule {}
