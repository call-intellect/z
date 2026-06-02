import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { LogBufferService, type SystemLogEntry } from './log-buffer.service';
import type { LogSettingsService } from './log-settings.service';
import type { LoggingRuntimeSettings } from './log.constants';

function entry(level: SystemLogEntry['level'], message = 'm'): SystemLogEntry {
  return { level, message };
}

function makeSettings(over: Partial<LoggingRuntimeSettings>): LogSettingsService {
  const settings: LoggingRuntimeSettings = {
    dbLoggingEnabled: true,
    minLevel: 'DEBUG',
    batchSize: 9999,
    flushIntervalMs: 5000,
    maxBufferSize: 5000,
    retentionDays: 30,
    logStackTraces: true,
    requestBodyLogging: false,
    responseBodyLogging: false,
    logSuccessfulRequests: false,
    slowRequestThresholdMs: 2000,
    enabledCategories: [],
    disabledModules: [],
    ...over,
  };
  return { get: () => settings } as unknown as LogSettingsService;
}

describe('LogBufferService', () => {
  let createMany: ReturnType<typeof vi.fn>;
  let prisma: PrismaService;

  beforeEach(() => {
    createMany = vi.fn().mockResolvedValue({ count: 0 });
    prisma = { systemLog: { createMany } } as unknown as PrismaService;
  });

  it('overflow: отбрасывает наименее важные, ERROR/FATAL переживают', () => {
    const buf = new LogBufferService(prisma, makeSettings({ maxBufferSize: 3, batchSize: 9999 }));
    buf.enqueue(entry('DEBUG'));
    buf.enqueue(entry('ERROR'));
    buf.enqueue(entry('INFO'));
    expect(buf.size()).toBe(3);
    // 4-я запись вытесняет первый DEBUG/INFO/WARN (DEBUG@0)
    buf.enqueue(entry('WARN'));
    expect(buf.size()).toBe(3);
    // ещё одна — вытесняет INFO; ERROR остаётся
    buf.enqueue(entry('FATAL'));
    expect(buf.size()).toBe(3);
  });

  it('flush: createMany со всем буфером, затем пусто', async () => {
    const buf = new LogBufferService(prisma, makeSettings({ batchSize: 9999 }));
    buf.enqueue(entry('INFO', 'a'));
    buf.enqueue(entry('ERROR', 'b'));
    await buf.flush();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data).toHaveLength(2);
    expect(buf.size()).toBe(0);
  });

  it('re-buffer: при ошибке БД пачка возвращается, следующий flush повторяет', async () => {
    createMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ count: 2 });
    const buf = new LogBufferService(prisma, makeSettings({ batchSize: 9999 }));
    buf.enqueue(entry('INFO', 'a'));
    buf.enqueue(entry('ERROR', 'b'));

    await buf.flush(); // упал
    expect(buf.size()).toBe(2); // вернулось

    await buf.flush(); // повтор успешен
    expect(buf.size()).toBe(0);
    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it('пустой буфер — flush не зовёт createMany', async () => {
    const buf = new LogBufferService(prisma, makeSettings({}));
    await buf.flush();
    expect(createMany).not.toHaveBeenCalled();
  });
});
