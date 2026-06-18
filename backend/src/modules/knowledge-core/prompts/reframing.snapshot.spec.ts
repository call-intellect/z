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
