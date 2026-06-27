import { describe, expect, it } from 'vitest';

import {
  PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
  PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from './probe-response-classify.prompt';

describe('probe-response-classify prompt — JSON Schema strict', () => {
  it('SCHEMA_NAME = probe_response_intent_v1', () => {
    expect(PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME).toBe('probe_response_intent_v1');
  });

  it('required = [reasoning, outcome, value, confidence]', () => {
    const required = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.required;
    expect(required).toEqual(['reasoning', 'outcome', 'value', 'confidence']);
  });

  it('additionalProperties=false (strict)', () => {
    expect(PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('outcome — enum [apply, delete, refine, counter_question, unclear]', () => {
    const properties = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.outcome?.type).toBe('string');
    expect(properties.outcome?.enum).toEqual([
      'apply',
      'delete',
      'refine',
      'counter_question',
      'unclear',
    ]);
  });

  it('value — string ≤ 1000', () => {
    const properties = PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const value = properties.value;
    expect(value).toBeDefined();
    expect(value?.type).toBe('string');
    expect(value?.maxLength).toBe(1000);
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

  it('SYSTEM стабилен (без runtime-переменных) — кэш-дружественный', () => {
    expect(PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });

  it('USER_TEMPLATE кладёт переменные в конец и упоминает schema name', () => {
    const user = PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE({
      question: 'Когда дедлайн?',
      response: 'Завтра к 18:00.',
    });
    expect(user).toContain('Когда дедлайн?');
    expect(user).toContain('Завтра к 18:00.');
    expect(user).toContain('probe_response_intent_v1');
    const lines = user.split('\n');
    expect(lines[lines.length - 1]).toContain('probe_response_intent_v1');
  });
});
