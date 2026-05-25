import { Module } from '@nestjs/common';

import { AdminEntitlementsController } from './entitlements.controller';
import { AdminEntitlementsService } from './entitlements.service';

/**
 * Admin-redesign Фаза 4 — `AdminEntitlementsModule`.
 *
 * Глобальный обзор OrgEntitlement + per-org мутации. Подключается в
 * `AdminModule`.
 */
@Module({
  controllers: [AdminEntitlementsController],
  providers: [AdminEntitlementsService],
  exports: [AdminEntitlementsService],
})
export class AdminEntitlementsModule {}
