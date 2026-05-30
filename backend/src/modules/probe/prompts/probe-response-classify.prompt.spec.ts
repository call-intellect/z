/**
 * Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify.
 *
 * Property test для `PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA`. Проверяет:
 *   - required = [answer, confidence, requiresFollowup];
 *   - additionalProperties=false (strict JSON);
 *   - confidence — number 0..1;
 *   - answer — string ≤1000;
 *   - schema name = probe_response_classify_v1;
 *   - cache-friendly: SYSTEM не содержит переменных подстановок,
 *     USER упоминает schema name в конце.
 */
import { describe, expect, it } from 'vitest';

import {
  PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
  PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from './probe-response-classify.prompt';

describe('probe-response-classify prompt — JSON Schema strict', () => {
  it('SCHEMA_NAME = probe_response_classify_v1', () => {
    expect(PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME).toBe(
      'probe_response_classify_v1',
    );
  });

  it('required = [answer, confidence, requiresFollowup]', () => {
    const required = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.required;
    expect(required).toEqual(['answer', 'confidence', 'requiresFollowup']);
  });

  it('additionalProperties=false (strict)', () => {
    expect(PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.additionalProperties).toBe(
      false,
    );
  });

  it('answer — string ≤ 1000', () => {
    const properties = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const answer = properties.answer;
    expect(answer).toBeDefined();
    expect(answer?.type).toBe('string');
    expect(answer?.maxLength).toBe(1000);
  });

  it('confidence — number в диапазоне [0, 1]', () => {
    const properties = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const confidence = properties.confidence;
    expect(confidence?.type).toBe('number');
    expect(confidence?.minimum).toBe(0);
    expect(confidence?.maximum).toBe(1);
  });

  it('requiresFollowup — boolean', () => {
    const properties = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.requiresFollowup?.type).toBe('boolean');
  });

  it('SYSTEM стабилен (без runtime-переменных) — кэш-дружественный', () => {
    // Регрессия: SYSTEM не должен содержать `${...}`. Тогда у DeepSeek/
    // OpenAI-proxy/MiniMax cache hit ≈99% между вызовами.
    expect(PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });

  it('USER_TEMPLATE кладёт переменные в конец и упоминает schema name', () => {
    const user = PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE({
      question: 'Когда дедлайн?',
      response: 'Завтра к 18:00.',
    });
    expect(user).toContain('Когда дедлайн?');
    expect(user).toContain('Завтра к 18:00.');
    expect(user).toContain('probe_response_classify_v1');
    // Переменные данные — в первых строках; финальная строка — про схему.
    // Это нужно, чтобы префикс SYSTEM + начало USER оставались стабильными.
    const lines = user.split('\n');
    expect(lines[lines.length - 1]).toContain('probe_response_classify_v1');
  });
});
