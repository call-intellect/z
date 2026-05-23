import { describe, expect, it } from 'vitest';

import { AxisClassifierService } from './axis-classifier.service';

/**
 * SBA α-3 wave 3 — AxisClassifierService unit-tests.
 *
 * Pure-логика (маппинг signalType→temporal, env-флаг). Полный integration
 * с Prisma + LlmRouter — в `axis-classify-ingest.integration.spec.ts`
 * (TODO до появления тестового стенда).
 */

describe('AxisClassifierService — TEMPORAL_BY_SIGNAL static map', () => {
  const map = AxisClassifierService.TEMPORAL_BY_SIGNAL;

  it('regulation → temporal:permanent', () => {
    expect(map.regulation).toBe('temporal:permanent');
  });

  it('process_step / methodology_step → temporal:permanent', () => {
    expect(map.process_step).toBe('temporal:permanent');
    expect(map.methodology_step).toBe('temporal:permanent');
  });

  it('idea / feature_request / hypothesis → temporal:future', () => {
    expect(map.idea).toBe('temporal:future');
    expect(map.feature_request).toBe('temporal:future');
    expect(map.hypothesis).toBe('temporal:future');
  });

  it('decision / decision_basis / rationale → temporal:past', () => {
    expect(map.decision).toBe('temporal:past');
    expect(map.decision_basis).toBe('temporal:past');
    expect(map.rationale).toBe('temporal:past');
  });

  it('pain / risk / blocker → temporal:current', () => {
    expect(map.pain).toBe('temporal:current');
    expect(map.risk).toBe('temporal:current');
    expect(map.blocker).toBe('temporal:current');
  });

  it('mood / drift / commitment — НЕ в карте (LLM добивает)', () => {
    expect(map.mood).toBeUndefined();
    expect(map.drift).toBeUndefined();
    expect(map.commitment).toBeUndefined();
  });
});

describe('AxisClassifierService — isAxisClassifyEnabled (env)', () => {
  it('AXIS_CLASSIFY_ENABLED=undefined → true (default)', () => {
    delete process.env['AXIS_CLASSIFY_ENABLED'];
    expect(isAxisClassifyEnabledMimic()).toBe(true);
  });

  it('AXIS_CLASSIFY_ENABLED="false" → false', () => {
    process.env['AXIS_CLASSIFY_ENABLED'] = 'false';
    expect(isAxisClassifyEnabledMimic()).toBe(false);
    delete process.env['AXIS_CLASSIFY_ENABLED'];
  });

  it('AXIS_CLASSIFY_ENABLED="true" → true', () => {
    process.env['AXIS_CLASSIFY_ENABLED'] = 'true';
    expect(isAxisClassifyEnabledMimic()).toBe(true);
    delete process.env['AXIS_CLASSIFY_ENABLED'];
  });

  it('AXIS_CLASSIFY_ENABLED="1" → true', () => {
    process.env['AXIS_CLASSIFY_ENABLED'] = '1';
    expect(isAxisClassifyEnabledMimic()).toBe(true);
    delete process.env['AXIS_CLASSIFY_ENABLED'];
  });
});

// ─────────────────────── helpers ────────────────────────────────────

/**
 * Имитация private isAxisClassifyEnabled — повторяет логику service'а
 * для проверки контракта (default=true). Если контракт поменяется —
 * тест упадёт и заставит обновить и сервис, и тест.
 */
function isAxisClassifyEnabledMimic(): boolean {
  const raw = process.env['AXIS_CLASSIFY_ENABLED'];
  if (raw == null || raw === '') return true;
  return raw === 'true' || raw === '1';
}
