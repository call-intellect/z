/**
 * Agents v2 Фаза B1 (2026-05-30) — AutoRule extract prompt snapshot.
 *
 * Property test для `AUTORULE_EXTRACT_JSON_SCHEMA`:
 *   - required = [rule, ruleType, confidence, examples, reasoning];
 *   - additionalProperties=false (strict);
 *   - rule ≤ 200, examples 1..3, ruleType ∈ {must_do, must_not_do, tone, structure};
 *   - SCHEMA_NAME = autorule_extract_v1;
 *   - SYSTEM cache-friendly (без runtime-переменных);
 *   - USER кладёт переменные в конец, упоминает schema name.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTORULE_EXTRACT_JSON_SCHEMA,
  AUTORULE_EXTRACT_SCHEMA_NAME,
  AUTORULE_EXTRACT_SYSTEM_PROMPT,
  AUTORULE_EXTRACT_USER_TEMPLATE,
} from './autorule-extract.prompt';

describe('autorule-extract prompt — JSON Schema strict', () => {
  it('SCHEMA_NAME = autorule_extract_v1', () => {
    expect(AUTORULE_EXTRACT_SCHEMA_NAME).toBe('autorule_extract_v1');
  });

  it('required содержит все 5 полей', () => {
    expect(AUTORULE_EXTRACT_JSON_SCHEMA.required).toEqual([
      'rule',
      'ruleType',
      'confidence',
      'examples',
      'reasoning',
    ]);
  });

  it('additionalProperties=false (strict)', () => {
    expect(AUTORULE_EXTRACT_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('rule — string 5..200', () => {
    const props = AUTORULE_EXTRACT_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.rule?.type).toBe('string');
    expect(props.rule?.minLength).toBe(5);
    expect(props.rule?.maxLength).toBe(200);
  });

  it('ruleType — enum строго 4 значения', () => {
    const props = AUTORULE_EXTRACT_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.ruleType?.enum).toEqual([
      'must_do',
      'must_not_do',
      'tone',
      'structure',
    ]);
  });

  it('confidence ∈ [0, 1]', () => {
    const props = AUTORULE_EXTRACT_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.confidence?.type).toBe('number');
    expect(props.confidence?.minimum).toBe(0);
    expect(props.confidence?.maximum).toBe(1);
  });

  it('examples — array 1..3, item имеет originalSnippet/editedSnippet/why', () => {
    const props = AUTORULE_EXTRACT_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const ex = props.examples;
    expect(ex?.type).toBe('array');
    expect(ex?.minItems).toBe(1);
    expect(ex?.maxItems).toBe(3);
    const item = ex?.items as Record<string, unknown>;
    expect(item?.required).toEqual(['originalSnippet', 'editedSnippet', 'why']);
    expect(item?.additionalProperties).toBe(false);
  });

  it('SYSTEM стабилен (без `${...}`) — cache-friendly', () => {
    expect(AUTORULE_EXTRACT_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });

  it('USER_TEMPLATE: переменные в конце, упоминает schema name', () => {
    const user = AUTORULE_EXTRACT_USER_TEMPLATE({
      promptKey: 'meeting-report-fast',
      examples: [
        { original: 'A', edited: 'B' },
        { original: 'C', edited: 'D' },
      ],
    });
    expect(user).toContain('meeting-report-fast');
    expect(user).toContain('Пар: 2');
    expect(user).toContain('autorule_extract_v1');
    const lines = user.split('\n');
    expect(lines[lines.length - 1]).toContain('autorule_extract_v1');
  });
});
