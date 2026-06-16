import { Global, Module } from '@nestjs/common';

import { DbLoggerBridge } from './db-logger.bridge';
import { LogBufferService } from './log-buffer.service';
import { LogCleanupService } from './log-cleanup.service';
import { PipelineRunner } from './log-pipeline';
import { LogSettingsService } from './log-settings.service';
import { LogStreamGateway } from './log-stream.gateway';
import { LogService } from './log.service';
import { RequestContextService } from './request-context.service';
import { SystemLogsController } from './system-logs.controller';

@Global()
@Module({
  controllers: [SystemLogsController],
  providers: [
    RequestContextService,
    LogSettingsService,
    LogBufferService,
    LogService,
    LogCleanupService,
    DbLoggerBridge,
    PipelineRunner,
    LogStreamGateway,
  ],
  exports: [
    LogService,
    LogSettingsService,
    LogBufferService,
    LogCleanupService,
    RequestContextService,
    DbLoggerBridge,
    PipelineRunner,
    LogStreamGateway,
  ],
})
export class LoggingModule {}
