import { describe, expect, it } from 'vitest';

import {
  BLOCK_LINK_TYPES,
  BLOCK_LINKER_JSON_SCHEMA,
  BLOCK_LINKER_SYSTEM_PROMPT,
} from './block-linker.prompt';

describe('block-linker — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(BLOCK_LINKER_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(BLOCK_LINKER_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('перечень типов связей стабилен', () => {
    expect(BLOCK_LINK_TYPES).toMatchSnapshot('link-types');
  });
});
