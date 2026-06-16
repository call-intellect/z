import { describe, expect, it } from 'vitest';

import {
  toDecisionProvenance,
  toPolicyProvenance,
  toProcessProvenance,
  toRegulationProvenance,
} from './documents.dto';

describe('documents provenance mappers — trustTier (Фаза C1)', () => {
  it('toDecisionProvenance: currentVersion.trustTier=provisional → trustTier=provisional', () => {
    const out = toDecisionProvenance({
      id: 'd1',
      text: 'Решили перейти на еженедельные планёрки',
      statement: null,
      currentVersion: { trustTier: 'provisional' },
    });
    expect(out.trustTier).toBe('provisional');
    expect(out.id).toBe('d1');
    expect(out.text).toBe('Решили перейти на еженедельные планёрки');
  });

  it('toDecisionProvenance: currentVersion=null → trustTier=human (default)', () => {
    const out = toDecisionProvenance({
      id: 'd2',
      text: null,
      statement: 'fallback на statement',
      currentVersion: null,
    });
    expect(out.trustTier).toBe('human');
    expect(out.text).toBe('fallback на statement');
  });

  it('toRegulationProvenance: currentVersion.trustTier=auto → trustTier=auto', () => {
    const out = toRegulationProvenance({
      id: 'r1',
      name: 'Регламент онбординга',
      category: 'regulation',
      confidence: 0.9,
      currentVersion: { trustTier: 'auto' },
    });
    expect(out.trustTier).toBe('auto');
    expect(out.confidence).toBe(0.9);
  });

  it('toRegulationProvenance: currentVersion=null → trustTier=human', () => {
    const out = toRegulationProvenance({
      id: 'r2',
      name: 'Регламент без версии',
      category: 'standard',
      confidence: null,
      currentVersion: null,
    });
    expect(out.trustTier).toBe('human');
  });

  it('toProcessProvenance: currentVersion.trustTier=provisional → trustTier=provisional', () => {
    const out = toProcessProvenance({
      id: 'p1',
      name: 'Процесс согласования бюджета',
      confidence: 0.75,
      currentVersion: { trustTier: 'provisional' },
    });
    expect(out.trustTier).toBe('provisional');
  });

  it('toProcessProvenance: currentVersion=null → trustTier=human', () => {
    const out = toProcessProvenance({
      id: 'p2',
      name: 'Процесс без версии',
      confidence: null,
      currentVersion: null,
    });
    expect(out.trustTier).toBe('human');
  });

  it('toPolicyProvenance: currentVersion.trustTier=auto → trustTier=auto', () => {
    const out = toPolicyProvenance({
      id: 'pol1',
      name: 'Политика доступа',
      severity: 'mandatory',
      confidence: 0.8,
      currentVersion: { trustTier: 'auto' },
    });
    expect(out.trustTier).toBe('auto');
  });

  it('toPolicyProvenance: currentVersion=null → trustTier=human', () => {
    const out = toPolicyProvenance({
      id: 'pol2',
      name: 'Политика без версии',
      severity: 'advisory',
      confidence: null,
      currentVersion: null,
    });
    expect(out.trustTier).toBe('human');
  });
});
