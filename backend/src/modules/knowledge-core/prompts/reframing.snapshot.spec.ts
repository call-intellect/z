/**
 * Snapshot-тест промта `reframing.prompt.ts`.
 *
 * Фиксирует:
 *   - `REFRAMING_BLOCKS_SYSTEM_PROMPT` + `REFRAMING_BLOCKS_JSON_SCHEMA`
 *     (ночной анализ свежих блоков);
 *   - `REFRAMING_THEMES_SYSTEM_PROMPT` + `REFRAMING_THEMES_JSON_SCHEMA`
 *     (рефлексия над Theme'ами).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  REFRAMING_BLOCKS_JSON_SCHEMA,
  REFRAMING_BLOCKS_SYSTEM_PROMPT,
  REFRAMING_THEMES_JSON_SCHEMA,
  REFRAMING_THEMES_SYSTEM_PROMPT,
} from './reframing.prompt';

describe('reframing — snapshot сборки промта', () => {
  it('blocks system prompt стабилен', () => {
    expect(REFRAMING_BLOCKS_SYSTEM_PROMPT).toMatchSnapshot('blocks-system');
  });

  it('blocks JSON Schema стабилен', () => {
    expect(REFRAMING_BLOCKS_JSON_SCHEMA).toMatchSnapshot('blocks-schema');
  });

  it('themes system prompt стабилен', () => {
    expect(REFRAMING_THEMES_SYSTEM_PROMPT).toMatchSnapshot('themes-system');
  });

  it('themes JSON Schema стабилен', () => {
    expect(REFRAMING_THEMES_JSON_SCHEMA).toMatchSnapshot('themes-schema');
  });
});
