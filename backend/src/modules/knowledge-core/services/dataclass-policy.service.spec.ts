import type { DataClass } from '@prisma/client';
import { describe, expect, it, beforeEach } from 'vitest';

import { DATACLASS_RANK, DataClassPolicyService } from './dataclass-policy.service';
import type { DataClassSource, DerivedKind } from './dataclass-policy.types';

/**
 * W4.1 — unit-тесты `DataClassPolicyService`.
 *
 * Источник инвариантов: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * §4 + §W4.1 (Property-based тесты).
 *
 * `fast-check` в backend/package.json отсутствует — используем табличные
 * unit-тесты, покрывающие те же инварианты на репрезентативных кейсах.
 * При добавлении `fast-check` (отдельная фаза) тесты можно переписать на
 * property-based без потери покрытия.
 */

// Заглушка TypedConfigService — derive() не дёргает getDynamic (только
// version). canEmit/derive ничего больше не читают через cfg.
function makeService(): DataClassPolicyService {
  const fakeCfg = {
    dataClassPolicy: { enforcement: 'shadow' as const, version: 'v1' },
    getDynamic: async () => null,
  } as unknown as ConstructorParameters<typeof DataClassPolicyService>[0];
  return new DataClassPolicyService(fakeCfg);
}

function src(
  overrides: Partial<DataClassSource> = {},
): DataClassSource {
  return {
    dataClass: 'internal',
    sourceId: 'b1',
    sourceKind: 'idea_block',
    subjectPersonId: null,
    ...overrides,
  };
}

const ALL_CLASSES: DataClass[] = ['public', 'internal', 'sensitive', 'private'];

describe('DataClassPolicyService.derive — инварианты W4.1', () => {
  let svc: DataClassPolicyService;

  beforeEach(() => {
    svc = makeService();
  });

  // ── #1 Идемпотентность: один источник → результат >= источника ───────
  it('идемпотентность: derive([s], kind).dataClass >= s.dataClass', () => {
    const kinds: DerivedKind[] = [
      'insight',
      'decision',
      'idea_block',
      'card_rollup',
      'executable_persona',
      'skill_trait',
    ];
    for (const kind of kinds) {
      for (const cls of ALL_CLASSES) {
        const result = svc.derive({
          sources: [src({ dataClass: cls })],
          context: { kind },
        });
        expect(
          DATACLASS_RANK[result.dataClass] >= DATACLASS_RANK[cls],
          `derive([${cls}], ${kind}) = ${result.dataClass} должен быть >= ${cls}`,
        ).toBe(true);
      }
    }
  });

  // ── #2 Монотонность: добавление источников не понижает результат ─────
  it('монотонность: derive([a,b], k) >= max(derive([a],k), derive([b],k))', () => {
    const kind: DerivedKind = 'insight';
    const cases: Array<[DataClass, DataClass]> = [
      ['public', 'internal'],
      ['internal', 'sensitive'],
      ['public', 'sensitive'],
      ['public', 'public'],
    ];
    for (const [a, b] of cases) {
      const ra = svc.derive({
        sources: [src({ dataClass: a, sourceId: 'a' })],
        context: { kind },
      }).dataClass;
      const rb = svc.derive({
        sources: [src({ dataClass: b, sourceId: 'b' })],
        context: { kind },
      }).dataClass;
      const rab = svc.derive({
        sources: [
          src({ dataClass: a, sourceId: 'a' }),
          src({ dataClass: b, sourceId: 'b' }),
        ],
        context: { kind },
      }).dataClass;
      const expectedMin = Math.max(DATACLASS_RANK[ra], DATACLASS_RANK[rb]);
      expect(DATACLASS_RANK[rab]).toBeGreaterThanOrEqual(expectedMin);
    }
  });

  // ── #3 Sensitive не утекает: ≥1 sensitive → result ∈ {sensitive,private} ─
  it('sensitive не утекает: при ≥1 sensitive в sources результат ∈ {sensitive,private}', () => {
    const kinds: DerivedKind[] = [
      'insight',
      'decision',
      'card_rollup',
      'executable_persona',
      'skill_trait',
      'chat_context',
    ];
    for (const kind of kinds) {
      const result = svc.derive({
        sources: [
          src({ dataClass: 'public', sourceId: 'p' }),
          src({ dataClass: 'sensitive', sourceId: 's' }),
          src({ dataClass: 'internal', sourceId: 'i' }),
        ],
        context: { kind },
      }).dataClass;
      expect(['sensitive', 'private']).toContain(result);
    }
  });

  // ── #4 Private aggregation: ≥1 private + kind=insight → sensitive ────
  it('private aggregation: ≥2 разных subjectPersonId в private+insight → sensitive, subjectPersonId=null', () => {
    const result = svc.derive({
      sources: [
        src({
          dataClass: 'private',
          subjectPersonId: 'alice',
          sourceId: 's1',
        }),
        src({
          dataClass: 'private',
          subjectPersonId: 'bob',
          sourceId: 's2',
        }),
        src({ dataClass: 'internal', sourceId: 's3' }),
      ],
      context: { kind: 'insight' },
    });
    expect(result.dataClass).toBe('sensitive');
    expect(result.subjectPersonId).toBeNull();
    expect(result.audit.rule).toBe('private-aggregation-to-sensitive');
  });

  it('private single-subject: один private subject + insight → private с этим subjectPersonId', () => {
    const result = svc.derive({
      sources: [
        src({
          dataClass: 'private',
          subjectPersonId: 'alice',
          sourceId: 's1',
        }),
        src({ dataClass: 'internal', sourceId: 's2' }),
      ],
      context: { kind: 'insight' },
    });
    expect(result.dataClass).toBe('private');
    expect(result.subjectPersonId).toBe('alice');
  });

  // ── #5 Floor executable_persona: всегда >= internal ──────────────────
  it('floor executable_persona/skill_profile: всегда >= internal даже при всех public', () => {
    for (const kind of ['executable_persona', 'skill_profile'] as DerivedKind[]) {
      const result = svc.derive({
        sources: [
          src({ dataClass: 'public', sourceId: 'p1' }),
          src({ dataClass: 'public', sourceId: 'p2' }),
        ],
        context: { kind },
      }).dataClass;
      expect(DATACLASS_RANK[result]).toBeGreaterThanOrEqual(
        DATACLASS_RANK['internal'],
      );
      expect(result).toBe('internal');
    }
  });

  it('floor insight: всегда >= internal', () => {
    const result = svc.derive({
      sources: [src({ dataClass: 'public', sourceId: 'p' })],
      context: { kind: 'insight' },
    }).dataClass;
    expect(result).toBe('internal');
  });

  it('explicitFloor имеет приоритет над DEFAULT_FLOORS', () => {
    const result = svc.derive({
      sources: [src({ dataClass: 'public', sourceId: 'p' })],
      context: { kind: 'insight', explicitFloor: 'sensitive' },
    });
    expect(result.dataClass).toBe('sensitive');
    expect(result.audit.rule).toBe('explicit-floor');
  });

  // ── audit-trail ──────────────────────────────────────────────────────
  it('audit заполняется: sourceIds + inputClasses + policyVersion + derivedAt', () => {
    const result = svc.derive({
      sources: [
        src({ dataClass: 'public', sourceId: 'a' }),
        src({ dataClass: 'sensitive', sourceId: 'b' }),
      ],
      context: { kind: 'insight' },
    });
    expect(result.audit.sourceIds).toEqual(['a', 'b']);
    expect(result.audit.inputClasses).toEqual(['public', 'sensitive']);
    expect(result.audit.policyVersion).toBe('v1');
    expect(result.audit.derivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.audit.result).toBe('sensitive');
  });

  it('пустые sources + insight → internal (floor применился)', () => {
    const result = svc.derive({
      sources: [],
      context: { kind: 'insight' },
    });
    expect(result.dataClass).toBe('internal');
    expect(result.audit.floorApplied).toBe('internal');
  });
});

describe('DataClassPolicyService.canEmit — gating outbound каналов', () => {
  let svc: DataClassPolicyService;

  beforeEach(() => {
    svc = makeService();
  });

  // ── #6 canEmit reject: sink.maxDataClass=internal + payload=sensitive ─
  it('reject: sink.maxDataClass=internal + payload=sensitive → allowed=false', () => {
    const result = svc.canEmit({
      payloadDataClass: 'sensitive',
      sink: { maxDataClass: 'internal', channel: 'telegram-public' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/sensitive/);
    expect(result.reason).toMatch(/internal/);
  });

  it('accept: payload<=sink.maxDataClass → allowed=true', () => {
    const result = svc.canEmit({
      payloadDataClass: 'internal',
      sink: { maxDataClass: 'sensitive' },
    });
    expect(result.allowed).toBe(true);
  });

  it('accept: payload=public + sink.maxDataClass=public → allowed=true', () => {
    const result = svc.canEmit({
      payloadDataClass: 'public',
      sink: { maxDataClass: 'public' },
    });
    expect(result.allowed).toBe(true);
  });

  it('reject: payload=private + sink.maxDataClass=sensitive → allowed=false', () => {
    const result = svc.canEmit({
      payloadDataClass: 'private',
      sink: { maxDataClass: 'sensitive', channel: 'email-broadcast' },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('email-broadcast');
  });
});

describe('DataClassPolicyService.compareWithLegacy — shadow-метрики', () => {
  it('равные значения — без warn (smoke: метод не падает)', () => {
    const svc = makeService();
    expect(() =>
      svc.compareWithLegacy({
        legacyResult: 'internal',
        proposedResult: 'internal',
        kind: 'insight',
        sourceIds: ['b1', 'b2'],
      }),
    ).not.toThrow();
  });

  it('расходящиеся значения — не падает (логирует warn)', () => {
    const svc = makeService();
    expect(() =>
      svc.compareWithLegacy({
        legacyResult: 'internal',
        proposedResult: 'sensitive',
        kind: 'insight',
        sourceIds: ['b1'],
      }),
    ).not.toThrow();
  });
});

// ──────── W4.2 KC-Temporal (2026-05-25) — регрессии enforce-режима ────────
describe('W4.2 — floor применяется и dataClass не понижается', () => {
  const svc = makeService();

  it('floor для каждого kind ≥ max(source.dataClass) ∩ legacy floor', () => {
    // По таблице §4 ТЗ: floor для основных kind'ов.
    const expectedFloor: Record<string, DataClass> = {
      insight: 'internal',
      decision: 'internal',
      card_rollup: 'internal',
      executable_persona: 'internal',
      skill_profile: 'internal',
      skill_trait: 'internal',
      idea: 'internal',
      regulation: 'internal',
      process: 'internal',
      policy: 'internal',
    };
    for (const [kind, floor] of Object.entries(expectedFloor)) {
      // public-источник → kind floor лифтит результат до 'internal'.
      const r = svc.derive({
        sources: [src({ dataClass: 'public' })],
        context: { kind: kind as DerivedKind },
      });
      expect(DATACLASS_RANK[r.dataClass]).toBeGreaterThanOrEqual(
        DATACLASS_RANK[floor],
      );
    }
  });

  it('никогда не понижает: derive([s], k).dataClass >= s.dataClass для всех kind', () => {
    const kinds: DerivedKind[] = [
      'insight',
      'decision',
      'idea',
      'card_rollup',
      'regulation',
      'process',
      'policy',
      'executable_persona',
      'skill_profile',
      'skill_trait',
    ];
    for (const kind of kinds) {
      for (const dc of ALL_CLASSES) {
        const r = svc.derive({
          sources: [src({ dataClass: dc })],
          context: { kind },
        });
        expect(DATACLASS_RANK[r.dataClass]).toBeGreaterThanOrEqual(
          DATACLASS_RANK[dc],
        );
      }
    }
  });
});
