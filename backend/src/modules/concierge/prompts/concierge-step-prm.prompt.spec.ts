/**
 * Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer prompt.
 *
 * Property test для `CONCIERGE_STEP_PRM_JSON_SCHEMA` и стабильности
 * SYSTEM/USER. Проверяет:
 *   - schema name = concierge_step_prm_v1;
 *   - required = [score, reasoning];
 *   - additionalProperties=false (strict JSON);
 *   - score — number 0..1;
 *   - reasoning — string ≤500;
 *   - SYSTEM стабилен (без runtime-переменных) — cache-friendly;
 *   - USER_TEMPLATE кладёт переменные в конец и упоминает schema name.
 */
import { describe, expect, it } from 'vitest';

import {
  CONCIERGE_STEP_PRM_JSON_SCHEMA,
  CONCIERGE_STEP_PRM_SCHEMA_NAME,
  CONCIERGE_STEP_PRM_SYSTEM_PROMPT,
  CONCIERGE_STEP_PRM_USER_TEMPLATE,
} from './concierge-step-prm.prompt';

describe('concierge-step-prm prompt — JSON Schema strict', () => {
  it('SCHEMA_NAME = concierge_step_prm_v1', () => {
    expect(CONCIERGE_STEP_PRM_SCHEMA_NAME).toBe('concierge_step_prm_v1');
  });

  it('required = [score, reasoning]', () => {
    expect(CONCIERGE_STEP_PRM_JSON_SCHEMA.required).toEqual([
      'score',
      'reasoning',
    ]);
  });

  it('additionalProperties=false (strict)', () => {
    expect(CONCIERGE_STEP_PRM_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it('score — number в диапазоне [0, 1]', () => {
    const properties = CONCIERGE_STEP_PRM_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const score = properties.score;
    expect(score?.type).toBe('number');
    expect(score?.minimum).toBe(0);
    expect(score?.maximum).toBe(1);
  });

  it('reasoning — string ≤ 500', () => {
    const properties = CONCIERGE_STEP_PRM_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    const reasoning = properties.reasoning;
    expect(reasoning?.type).toBe('string');
    expect(reasoning?.maxLength).toBe(500);
  });

  it('SYSTEM стабилен (без runtime-переменных) — кэш-дружественный', () => {
    // Регрессия: SYSTEM не должен содержать `${...}`. Тогда у DeepSeek/
    // OpenAI-proxy/MiniMax cache hit ≈99% между вызовами.
    expect(CONCIERGE_STEP_PRM_SYSTEM_PROMPT).not.toMatch(/\$\{/);
    expect(CONCIERGE_STEP_PRM_SYSTEM_PROMPT).toContain('PRM');
  });

  it('USER_TEMPLATE кладёт переменные в конец и упоминает schema name', () => {
    const user = CONCIERGE_STEP_PRM_USER_TEMPLATE({
      goal: 'Сколько встреч на завтра?',
      historyDigest: '[user] привет',
      retrievedContextDigest: '#1 meeting #42',
      candidate: {
        toolName: 'search_meetings',
        args: { from: '2026-05-31', to: '2026-05-31' },
      },
    });
    expect(user).toContain('Сколько встреч на завтра?');
    expect(user).toContain('search_meetings');
    expect(user).toContain('concierge_step_prm_v1');
    // Финальная строка — про схему. Переменные данные раньше.
    const lines = user.split('\n');
    expect(lines[lines.length - 1]).toContain('concierge_step_prm_v1');
  });

  it('USER_TEMPLATE: пустая история/контекст → плейсхолдеры', () => {
    const user = CONCIERGE_STEP_PRM_USER_TEMPLATE({
      goal: 'Помощь',
      historyDigest: '',
      retrievedContextDigest: '',
      candidate: { toolName: 'help', args: {} },
    });
    expect(user).toContain('(нет истории)');
    expect(user).toContain('(нет контекста)');
  });
});
