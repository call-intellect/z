import { Module } from '@nestjs/common';

import { AdminEntitlementsController } from './entitlements.controller';
import { AdminEntitlementsService } from './entitlements.service';

@Module({
  controllers: [AdminEntitlementsController],
  providers: [AdminEntitlementsService],
  exports: [AdminEntitlementsService],
})
export class AdminEntitlementsModule {}
