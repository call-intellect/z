import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  getSchemaForKey,
  hasSchemaForKey,
  zodToSimpleSchema,
} from './admin-setting-schema-registry';

/**
 * Admin-redesign Фаза 3 — unit-тесты `AdminSettingSchemaRegistry`.
 */
describe('admin-setting-schema-registry', () => {
  it('getSchemaForKey возвращает z.unknown() для незнакомого ключа', () => {
    expect(hasSchemaForKey('does.not.exist')).toBe(false);
    const s = getSchemaForKey('does.not.exist');
    // z.unknown() принимает любое значение
    expect(s.safeParse('whatever').success).toBe(true);
    expect(s.safeParse(123).success).toBe(true);
  });

  it('knowledge.distillMergeThreshold — number [0..1]', () => {
    const s = getSchemaForKey('knowledge.distillMergeThreshold');
    expect(s.safeParse(0.85).success).toBe(true);
    expect(s.safeParse(0).success).toBe(true);
    expect(s.safeParse(1).success).toBe(true);
    expect(s.safeParse(1.5).success).toBe(false);
    expect(s.safeParse(-0.1).success).toBe(false);
  });

  it('knowledge.blockIngestWindowSegments — int positive', () => {
    const s = getSchemaForKey('knowledge.blockIngestWindowSegments');
    expect(s.safeParse(5).success).toBe(true);
    expect(s.safeParse(0).success).toBe(false);
    expect(s.safeParse(2.5).success).toBe(false);
  });

  it('knowledge.v2AgentsEnabled — boolean', () => {
    const s = getSchemaForKey('knowledge.v2AgentsEnabled');
    expect(s.safeParse(true).success).toBe(true);
    expect(s.safeParse('true').success).toBe(false);
  });

  it('embeddings.batchSize — int positive', () => {
    const s = getSchemaForKey('embeddings.batchSize');
    expect(s.safeParse(32).success).toBe(true);
    expect(s.safeParse(0).success).toBe(false);
  });

  it('embeddings.chunkOverlapTokens — int non-negative (0 разрешён)', () => {
    const s = getSchemaForKey('embeddings.chunkOverlapTokens');
    expect(s.safeParse(0).success).toBe(true);
    expect(s.safeParse(80).success).toBe(true);
    expect(s.safeParse(-1).success).toBe(false);
  });

  describe('zodToSimpleSchema', () => {
    it('number с min/max', () => {
      const out = zodToSimpleSchema(z.number().min(0).max(1));
      expect(out).toEqual({ type: 'number', min: 0, max: 1 });
    });

    it('integer (.int())', () => {
      const out = zodToSimpleSchema(z.number().int().positive());
      expect(out.type).toBe('integer');
      // positive → min присутствует, конкретное значение не утверждаем
      expect(typeof out.min).toBe('number');
    });

    it('boolean', () => {
      expect(zodToSimpleSchema(z.boolean())).toEqual({ type: 'boolean' });
    });

    it('string', () => {
      expect(zodToSimpleSchema(z.string())).toEqual({ type: 'string' });
    });

    it('enum', () => {
      const out = zodToSimpleSchema(z.enum(['a', 'b', 'c']));
      expect(out.type).toBe('enum');
      expect(out.enumValues).toEqual(['a', 'b', 'c']);
    });

    it('unknown → fallback', () => {
      expect(zodToSimpleSchema(z.unknown())).toEqual({ type: 'unknown' });
    });

    it('snimает обёртку z.optional() / z.default()', () => {
      expect(zodToSimpleSchema(z.number().int().optional()).type).toBe('integer');
      expect(zodToSimpleSchema(z.boolean().default(false)).type).toBe('boolean');
    });
  });
});
