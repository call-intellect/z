import { describe, expect, it } from 'vitest';

import { BLOCK_DISTILL_JSON_SCHEMA, BLOCK_DISTILL_SYSTEM_PROMPT } from './block-distill.prompt';

describe('block-distill — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(BLOCK_DISTILL_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(BLOCK_DISTILL_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
