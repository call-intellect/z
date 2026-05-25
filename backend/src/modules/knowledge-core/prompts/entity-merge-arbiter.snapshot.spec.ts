/**
 * Snapshot-тест промта `entity-merge-arbiter.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `ENTITY_MERGE_ARBITER_SYSTEM_PROMPT`;
 *   - JSON-схему `ENTITY_MERGE_ARBITER_JSON_SCHEMA`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  ENTITY_MERGE_ARBITER_JSON_SCHEMA,
  ENTITY_MERGE_ARBITER_SYSTEM_PROMPT,
} from './entity-merge-arbiter.prompt';

describe('entity-merge-arbiter — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(ENTITY_MERGE_ARBITER_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(ENTITY_MERGE_ARBITER_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
