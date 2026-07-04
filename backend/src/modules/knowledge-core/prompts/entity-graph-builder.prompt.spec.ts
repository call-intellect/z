import { describe, expect, it } from 'vitest';

import {
  ENTITY_LINK_JSON_SCHEMA,
  ENTITY_LINK_SYSTEM_PROMPT,
  ENTITY_LINK_TYPES,
} from './entity-graph-builder.prompt';

describe('entity-graph-builder — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(ENTITY_LINK_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(ENTITY_LINK_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('перечень типов связей стабилен', () => {
    expect(ENTITY_LINK_TYPES).toMatchSnapshot('link-types');
  });
});
