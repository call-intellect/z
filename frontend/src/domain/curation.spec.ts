import { describe, expect, it } from 'vitest';

import { triageReasonSummary } from './curation';

/**
 * Контракт `triageReasonSummary`: сводит технический `triageReason`
 * (пороги + английские ключи) к одной понятной фразе на русском. Гарантия —
 * в выводе НЕТ внутренних идентификаторов/чисел и английских аббревиатур.
 */
describe('triageReasonSummary', () => {
  it('критический тип → фраза про важный тип знания', () => {
    const s = triageReasonSummary({ criticalType: true, conflictSignal: 'none' });
    expect(s).toContain('важный тип знания');
  });

  it('жёсткий конфликт → фраза про противоречие', () => {
    const s = triageReasonSummary({ criticalType: false, conflictSignal: 'hard' });
    expect(s).toContain('противоречит');
  });

  it('мягкий конфликт → фраза про возможный дубль', () => {
    const s = triageReasonSummary({ conflictSignal: 'soft' });
    expect(s).toContain('пересекаться');
  });

  it('низкая уверенность ниже порога → фраза про подробную проверку', () => {
    const s = triageReasonSummary({
      conflictSignal: 'none',
      confidence: 0.4,
      effectiveConfidence: 0.4,
      deepReviewThreshold: 0.6,
    });
    expect(s).toContain('подробная проверка');
  });

  it('уверенность между порогами → дефолтная фраза «не до конца уверен»', () => {
    const s = triageReasonSummary({
      conflictSignal: 'none',
      confidence: 0.7,
      deepReviewThreshold: 0.6,
    });
    expect(s).toContain('не до конца уверен');
  });

  it('правка пользователя (via=user_correction)', () => {
    const s = triageReasonSummary({ via: 'user_correction', reason: null });
    expect(s).toContain('предложил правку');
  });

  it('устаревшая карточка (reason=stale)', () => {
    const s = triageReasonSummary({ reason: 'stale' });
    expect(s).toContain('устареть');
  });

  it('аудит-выборка (reason=audit_sample)', () => {
    const s = triageReasonSummary({ reason: 'audit_sample' });
    expect(s).toContain('Выборочная проверка');
  });

  it('пустой / null reason не падает и даёт осмысленную фразу', () => {
    expect(triageReasonSummary(null)).toContain('ИИ');
    expect(triageReasonSummary(undefined)).toContain('ИИ');
    expect(triageReasonSummary({})).toContain('ИИ');
  });

  it('в выводе нет английских аббревиатур и сырых порогов', () => {
    const reason = {
      confidence: 0.4,
      effectiveConfidence: 0.4,
      conflictSignal: 'none',
      criticalType: false,
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      autoThresholdGlobal: 0.85,
      deepThresholdGlobal: 0.6,
    };
    const s = triageReasonSummary(reason);
    expect(s).not.toMatch(/[A-Za-z]/);
  });
});
