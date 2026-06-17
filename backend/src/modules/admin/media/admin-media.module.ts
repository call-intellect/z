import { Module } from '@nestjs/common';

import { AdminRetentionController } from './retention/admin-retention.controller';
import { AdminRetentionService } from './retention/admin-retention.service';
import { AdminStorageController } from './storage/admin-storage.controller';
import { AdminStorageService } from './storage/admin-storage.service';

@Module({
  controllers: [AdminRetentionController, AdminStorageController],
  providers: [AdminRetentionService, AdminStorageService],
  exports: [AdminRetentionService, AdminStorageService],
})
export class AdminMediaModule {}
