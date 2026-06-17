import { Global, Module } from '@nestjs/common';

import { ADMIN_SETTINGS_READER_TOKEN } from '../../../common/config/typed-config.service';

import { AdminSettingsBootstrapService } from './admin-settings-bootstrap.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';

@Global()
@Module({
  controllers: [AdminSettingsController],
  providers: [
    AdminSettingsService,
    AdminSettingsBootstrapService,
    {
      provide: ADMIN_SETTINGS_READER_TOKEN,
      useExisting: AdminSettingsService,
    },
  ],
  exports: [AdminSettingsService, ADMIN_SETTINGS_READER_TOKEN],
})
export class AdminSettingsModule {}
