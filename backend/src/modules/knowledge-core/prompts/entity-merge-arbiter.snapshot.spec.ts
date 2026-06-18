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
