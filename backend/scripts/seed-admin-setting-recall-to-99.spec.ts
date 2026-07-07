import { describe, expect, it } from 'vitest';

import { SEEDS } from './seed-admin-setting-recall-to-99';

const EXPECTED: ReadonlyArray<{ key: string; value: unknown; severity: string }> = [
  { key: 'knowledge.chatV2AssertiveSynthesis', value: true, severity: 'high' },
  { key: 'knowledge.chatV2GroundednessMode', value: 'lenient', severity: 'high' },
  { key: 'knowledge.chatV2GroundingEmbedding', value: true, severity: 'high' },
  { key: 'knowledge.chatV2GroundingEmbeddingTopK', value: 10, severity: 'medium' },
  { key: 'knowledge.chatV2GroundingEmbeddingMinSim', value: 0.35, severity: 'medium' },
  { key: 'knowledge.chatV2DeterministicPeriod', value: true, severity: 'high' },
  { key: 'knowledge.chatV2GraphCypherRecall', value: true, severity: 'high' },
  { key: 'knowledge.chatV2GraphCypherMaxDepth', value: 3, severity: 'medium' },
  { key: 'knowledge.graphReconcileEnabled', value: true, severity: 'high' },
  { key: 'knowledge.graphReconcileBatchSize', value: 500, severity: 'medium' },
];

describe('seed-admin-setting-recall-to-99 — 10 крутилок ТЗ recall-master-to-99', () => {
  it('ровно 10 сидов, ключи и дефолты совпадают с ТЗ', () => {
    expect(SEEDS).toHaveLength(EXPECTED.length);
    for (const expected of EXPECTED) {
      const seed = SEEDS.find((s) => s.key === expected.key);
      expect(seed, `сид ${expected.key} присутствует`).toBeDefined();
      expect(seed!.value).toEqual(expected.value);
      expect(seed!.severity).toBe(expected.severity);
      expect(seed!.category).toBe('ai');
      expect(seed!.section).toBe('knowledge');
      expect(seed!.description).toContain('recall-to-99');
    }
  });

  it('ключей без дублей', () => {
    const keys = SEEDS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
