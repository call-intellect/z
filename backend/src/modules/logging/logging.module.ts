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

/**
 * LoggingModule — централизованное техническое логирование в БД.
 *
 * `@Global`: `LogService`/`RequestContextService`/`DbLoggerBridge` доступны всему
 * приложению без повторного импорта. `DbLoggerBridge` подключается в `main.ts`
 * через `app.useLogger(...)` — мост Nest Logger → БД.
 *
 * D3 (2026-06-03): HTTP-логирование (REQUEST) отключено — `RequestLoggingInterceptor`
 * больше не регистрируется. Ошибки запросов пишет `AllExceptionsFilter`.
 *
 * См. plans/tz/2026-06-01-logging-module.md + plans/tz/2026-06-03-logging-pipelines-coverage.md.
 */
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
