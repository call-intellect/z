import { describe, expect, it } from 'vitest';

import {
  buildRoleScopeFilter,
  parseRoleScope,
  rankRegulations,
  regulationPriorityRank,
  type RetrievedRegulation,
} from './role-scope.util';

describe('parseRoleScope', () => {
  it('валидный role:<id> → id', () => {
    expect(parseRoleScope('role:abc')).toBe('abc');
  });

  it("'org' → null", () => {
    expect(parseRoleScope('org')).toBeNull();
  });

  it('null → null', () => {
    expect(parseRoleScope(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseRoleScope(undefined)).toBeNull();
  });

  it("'role:' без id → null", () => {
    expect(parseRoleScope('role:')).toBeNull();
  });

  it('обрезает пробелы вокруг id', () => {
    expect(parseRoleScope('  role:  abc  ')).toBe('abc');
  });

  it("'role:   ' (только пробелы после) → null", () => {
    expect(parseRoleScope('role:   ')).toBeNull();
  });

  it('ограничивает id 120 символами', () => {
    const longId = 'x'.repeat(200);
    expect(parseRoleScope(`role:${longId}`)).toHaveLength(120);
  });
});

describe('buildRoleScopeFilter', () => {
  it('role-only при includeOrg=false и без departmentId', () => {
    expect(buildRoleScopeFilter({ roleId: 'r1', includeOrg: false })).toEqual(['role:r1']);
  });

  it('добавляет org при includeOrg=true', () => {
    expect(buildRoleScopeFilter({ roleId: 'r1', includeOrg: true })).toEqual(['role:r1', 'org']);
  });

  it('добавляет department при непустом departmentId', () => {
    expect(
      buildRoleScopeFilter({ roleId: 'r1', includeOrg: true, departmentId: 'd9' }),
    ).toEqual(['role:r1', 'org', 'department:d9']);
  });

  it('не добавляет department при пустой строке', () => {
    expect(
      buildRoleScopeFilter({ roleId: 'r1', includeOrg: false, departmentId: '   ' }),
    ).toEqual(['role:r1']);
  });

  it('не добавляет department при null', () => {
    expect(
      buildRoleScopeFilter({ roleId: 'r1', includeOrg: false, departmentId: null }),
    ).toEqual(['role:r1']);
  });
});

describe('regulationPriorityRank', () => {
  it('Policy + blocking → 0', () => {
    expect(regulationPriorityRank({ kind: 'policy', severity: 'blocking' })).toBe(0);
  });

  it('Policy + mandatory → 1', () => {
    expect(regulationPriorityRank({ kind: 'policy', severity: 'mandatory' })).toBe(1);
  });

  it('regulation/process/instruction → 2', () => {
    expect(regulationPriorityRank({ kind: 'regulation', severity: null })).toBe(2);
    expect(regulationPriorityRank({ kind: 'process', severity: null })).toBe(2);
    expect(regulationPriorityRank({ kind: 'instruction', severity: null })).toBe(2);
  });

  it('Policy + advisory → 3', () => {
    expect(regulationPriorityRank({ kind: 'policy', severity: 'advisory' })).toBe(3);
  });

  it('Policy без severity → 3', () => {
    expect(regulationPriorityRank({ kind: 'policy', severity: null })).toBe(3);
  });
});

describe('rankRegulations', () => {
  const make = (
    partial: Partial<RetrievedRegulation> & Pick<RetrievedRegulation, 'kind' | 'distance'>,
  ): RetrievedRegulation => ({
    id: partial.id ?? `${partial.kind}-${partial.distance}`,
    name: partial.name ?? 'n',
    text: partial.text ?? 't',
    severity: partial.severity ?? null,
    scope: partial.scope ?? null,
    ...partial,
  });

  it('blocking раньше mandatory раньше regulation раньше advisory', () => {
    const items: RetrievedRegulation[] = [
      make({ kind: 'policy', severity: 'advisory', distance: 0.01, id: 'adv' }),
      make({ kind: 'regulation', severity: null, distance: 0.02, id: 'reg' }),
      make({ kind: 'policy', severity: 'mandatory', distance: 0.03, id: 'man' }),
      make({ kind: 'policy', severity: 'blocking', distance: 0.04, id: 'blk' }),
    ];
    const ranked = rankRegulations(items, 10);
    expect(ranked.map((r) => r.id)).toEqual(['blk', 'man', 'reg', 'adv']);
  });

  it('при равном ранге меньший distance раньше', () => {
    const items: RetrievedRegulation[] = [
      make({ kind: 'regulation', severity: null, distance: 0.5, id: 'far' }),
      make({ kind: 'process', severity: null, distance: 0.1, id: 'near' }),
    ];
    const ranked = rankRegulations(items, 10);
    expect(ranked.map((r) => r.id)).toEqual(['near', 'far']);
  });

  it('topN режет результат', () => {
    const items: RetrievedRegulation[] = [
      make({ kind: 'policy', severity: 'blocking', distance: 0.1, id: 'a' }),
      make({ kind: 'policy', severity: 'mandatory', distance: 0.2, id: 'b' }),
      make({ kind: 'regulation', severity: null, distance: 0.3, id: 'c' }),
    ];
    const ranked = rankRegulations(items, 2);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('пустой вход → []', () => {
    expect(rankRegulations([], 5)).toEqual([]);
  });

  it('не мутирует вход', () => {
    const items: RetrievedRegulation[] = [
      make({ kind: 'policy', severity: 'advisory', distance: 0.01, id: 'adv' }),
      make({ kind: 'policy', severity: 'blocking', distance: 0.04, id: 'blk' }),
    ];
    const snapshot = items.map((r) => r.id);
    rankRegulations(items, 10);
    expect(items.map((r) => r.id)).toEqual(snapshot);
  });
});
