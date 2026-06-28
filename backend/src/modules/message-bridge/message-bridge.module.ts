import { Module } from '@nestjs/common';

import { MessageBridgeService } from './message-bridge.service';
import { TelegramExportImportService } from './telegram-export.service';

@Module({
  providers: [MessageBridgeService, TelegramExportImportService],
  exports: [MessageBridgeService, TelegramExportImportService],
})
export class MessageBridgeModule {}
