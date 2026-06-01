import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { LogBufferService } from './log-buffer.service';
import { LogCleanupService } from './log-cleanup.service';
import { LogSettingsService } from './log-settings.service';
import { LogService } from './log.service';
import { RequestContextService } from './request-context.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { SystemLogsController } from './system-logs.controller';

/**
 * LoggingModule — централизованное техническое логирование в БД.
 *
 * `@Global`: `LogService`/`RequestContextService` доступны всему приложению
 * без повторного импорта. Регистрирует глобальный `RequestLoggingInterceptor`.
 * Подключается в `AppModule`. См. plans/tz/2026-06-01-logging-module.md.
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
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
  exports: [
    LogService,
    LogSettingsService,
    LogBufferService,
    LogCleanupService,
    RequestContextService,
  ],
})
export class LoggingModule {}
