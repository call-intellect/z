/**
 * Snapshot-тест промта `theme-classify.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `THEME_CLASSIFY_SYSTEM_PROMPT`;
 *   - JSON-схему `THEME_CLASSIFY_JSON_SCHEMA`;
 *   - набор `THEME_BRANCH_VALUES` (12 веток компании).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  THEME_BRANCH_VALUES,
  THEME_CLASSIFY_JSON_SCHEMA,
  THEME_CLASSIFY_SYSTEM_PROMPT,
} from './theme-classify.prompt';

describe('theme-classify — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(THEME_CLASSIFY_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(THEME_CLASSIFY_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('перечень 12 веток компании стабилен', () => {
    expect(THEME_BRANCH_VALUES).toMatchSnapshot('branches');
  });
});
