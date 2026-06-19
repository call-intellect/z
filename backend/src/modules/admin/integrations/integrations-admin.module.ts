import { Module } from '@nestjs/common';

import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminIntegrationsService } from './admin-integrations.service';
import { AdminBotsController } from './bots/admin-bots.controller';
import { AdminBotsService } from './bots/admin-bots.service';
import { AdminLiveKitController } from './livekit/admin-livekit.controller';
import { AdminLiveKitService } from './livekit/admin-livekit.service';
import { AdminWebhooksMgmtController } from './webhooks/admin-webhooks-mgmt.controller';
import { AdminWebhooksMgmtService } from './webhooks/admin-webhooks-mgmt.service';

@Module({
  controllers: [
    AdminBotsController,
    AdminWebhooksMgmtController,
    AdminLiveKitController,
    AdminIntegrationsController,
  ],
  providers: [
    AdminBotsService,
    AdminWebhooksMgmtService,
    AdminLiveKitService,
    AdminIntegrationsService,
  ],
  exports: [AdminBotsService, AdminWebhooksMgmtService, AdminLiveKitService],
})
export class IntegrationsAdminModule {}
