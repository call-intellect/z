/**
 * Snapshot-тест промта `regulation-dedupe.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `REGULATION_DEDUPE_SYSTEM_PROMPT`;
 *   - JSON-схему `REGULATION_DEDUPE_JSON_SCHEMA`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  REGULATION_DEDUPE_JSON_SCHEMA,
  REGULATION_DEDUPE_SYSTEM_PROMPT,
} from './regulation-dedupe.prompt';

describe('regulation-dedupe — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(REGULATION_DEDUPE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(REGULATION_DEDUPE_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
