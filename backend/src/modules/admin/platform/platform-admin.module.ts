import { Module } from '@nestjs/common';

import { FeatureFlagsController } from './flags/feature-flags.controller';
import { FeatureFlagsService } from './flags/feature-flags.service';
import { LimitsAdminController } from './limits/limits-admin.controller';
import { LimitsAdminService } from './limits/limits-admin.service';
import { MaintenanceAdminController } from './maintenance/maintenance-admin.controller';
import { MaintenanceAdminService } from './maintenance/maintenance-admin.service';
import { SecurityAdminController } from './security/security-admin.controller';
import { SecurityAdminService } from './security/security-admin.service';
import { WorkersAdminController } from './workers/workers-admin.controller';
import { WorkersAdminService } from './workers/workers-admin.service';

@Module({
  controllers: [
    WorkersAdminController,
    LimitsAdminController,
    FeatureFlagsController,
    SecurityAdminController,
    MaintenanceAdminController,
  ],
  providers: [
    WorkersAdminService,
    LimitsAdminService,
    FeatureFlagsService,
    SecurityAdminService,
    MaintenanceAdminService,
  ],
  exports: [
    WorkersAdminService,
    LimitsAdminService,
    FeatureFlagsService,
    SecurityAdminService,
    MaintenanceAdminService,
  ],
})
export class PlatformAdminModule {}
