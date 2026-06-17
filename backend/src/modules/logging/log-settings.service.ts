import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

import {
  LOGGING_SETTINGS_KEY,
  type LoggingRuntimeSettings,
  normalizeLoggingSettings,
} from './log.constants';

const RELOAD_INTERVAL_MS = 30_000;

@Injectable()
export class LogSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogSettingsService.name);
  private cached: LoggingRuntimeSettings;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TypedConfigService,
  ) {
    this.cached = this.envBase();
  }

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.timer = setInterval(() => {
      void this.reload();
    }, RELOAD_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get(): LoggingRuntimeSettings {
    return this.cached;
  }

  async reload(): Promise<void> {
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key: LOGGING_SETTINGS_KEY },
        select: { valueJson: true },
      });
      this.cached = normalizeLoggingSettings(row?.valueJson ?? {}, this.envBase());
    } catch (err) {
      this.logger.warn(
        `Не удалось перечитать настройки логирования: ${(err as Error).message}. Используем кэш.`,
      );
    }
  }

  async applyUpdate(
    patch: Partial<LoggingRuntimeSettings>,
    actorId: string | undefined,
  ): Promise<LoggingRuntimeSettings> {
    const next = normalizeLoggingSettings({ ...this.cached, ...patch }, this.envBase());
    await this.prisma.platformSetting.upsert({
      where: { key: LOGGING_SETTINGS_KEY },
      create: {
        key: LOGGING_SETTINGS_KEY,
        valueJson: next as unknown as object,
        ...(actorId ? { updatedBy: actorId } : {}),
      },
      update: {
        valueJson: next as unknown as object,
        ...(actorId ? { updatedBy: actorId } : {}),
      },
    });
    this.cached = next;
    return next;
  }

  private envBase(): LoggingRuntimeSettings {
    const c = this.config.logging;
    return {
      dbLoggingEnabled: c.dbLoggingEnabled,
      minLevel: c.minLevel,
      batchSize: c.batchSize,
      flushIntervalMs: c.flushIntervalMs,
      maxBufferSize: c.maxBufferSize,
      retentionDays: c.retentionDays,
      logStackTraces: c.logStackTraces,
      requestBodyLogging: c.requestBodyLogging,
      responseBodyLogging: c.responseBodyLogging,
      logSuccessfulRequests: c.logSuccessfulRequests,
      slowRequestThresholdMs: c.slowRequestThresholdMs,
      enabledCategories: [],
      disabledModules: [],
    };
  }
}
