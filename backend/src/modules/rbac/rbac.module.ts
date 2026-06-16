import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { TenantGuard } from './guards/tenant.guard';
import { KnowledgeAccessResolver } from './knowledge-access-resolver.service';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { RbacService } from './rbac.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RbacService, KnowledgeAccessResolver, TenantGuard, TenantMiddleware],
  exports: [RbacService, KnowledgeAccessResolver, TenantGuard, TenantMiddleware],
})
export class RbacModule {}
