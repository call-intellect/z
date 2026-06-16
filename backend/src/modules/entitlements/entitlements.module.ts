import { Global, Module } from '@nestjs/common';

import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService } from './entitlement.service';
import { EntitlementsController } from './entitlements.controller';

@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementService, EntitlementGuard],
  exports: [EntitlementService, EntitlementGuard],
})
export class EntitlementsModule {}
