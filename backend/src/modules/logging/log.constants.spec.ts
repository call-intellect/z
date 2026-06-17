import { describe, expect, it } from 'vitest';

import { type LoggingRuntimeSettings, normalizeLoggingSettings } from './log.constants';

const BASE: LoggingRuntimeSettings = {
  dbLoggingEnabled: true,
  minLevel: 'INFO',
  batchSize: 50,
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
};

describe('normalizeLoggingSettings', () => {
  it('возвращает base при пустом/невалидном raw', () => {
    expect(normalizeLoggingSettings(null, BASE)).toEqual(BASE);
    expect(normalizeLoggingSettings('garbage', BASE)).toEqual(BASE);
    expect(normalizeLoggingSettings({}, BASE)).toEqual(BASE);
  });

  it('clamp чисел в границах', () => {
    const out = normalizeLoggingSettings(
      { batchSize: 999999, flushIntervalMs: 1, retentionDays: -5, maxBufferSize: 10 },
      BASE,
    );
    expect(out.batchSize).toBe(1000);
    expect(out.flushIntervalMs).toBe(500);
    expect(out.retentionDays).toBe(1);
    expect(out.maxBufferSize).toBe(100);
  });

  it('игнорирует невалидный minLevel, принимает валидный', () => {
    expect(normalizeLoggingSettings({ minLevel: 'NOPE' }, BASE).minLevel).toBe('INFO');
    expect(normalizeLoggingSettings({ minLevel: 'ERROR' }, BASE).minLevel).toBe('ERROR');
  });

  it('boolean: принимает только настоящие boolean', () => {
    expect(normalizeLoggingSettings({ dbLoggingEnabled: false }, BASE).dbLoggingEnabled).toBe(
      false,
    );
    expect(normalizeLoggingSettings({ dbLoggingEnabled: 'false' }, BASE).dbLoggingEnabled).toBe(
      true,
    );
  });

  it('enabledCategories: фильтрует мусор, дедуп, лимит 20', () => {
    const out = normalizeLoggingSettings(
      { enabledCategories: ['AUTH', 'AUTH', 'NOPE', 'DB', 123] },
      BASE,
    );
    expect(out.enabledCategories).toEqual(['AUTH', 'DB']);
  });

  it('disabledModules: trim, дроп пустых/нестрок, дедуп', () => {
    const out = normalizeLoggingSettings(
      { disabledModules: ['  http ', 'http', '', 42, 'billing'] },
      BASE,
    );
    expect(out.disabledModules).toEqual(['http', 'billing']);
  });
});
