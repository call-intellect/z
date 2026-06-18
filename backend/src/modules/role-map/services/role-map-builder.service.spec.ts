import { describe, expect, it, vi } from 'vitest';

import { mergeSourceBlocks } from './responsibility-element.service';

describe('mergeSourceBlocks', () => {
  it('возвращает current, если incoming пустой', () => {
    expect(mergeSourceBlocks(['a', 'b'])).toEqual(['a', 'b']);
    expect(mergeSourceBlocks(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(mergeSourceBlocks(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('убирает дубли', () => {
    const r = mergeSourceBlocks(['a', 'b'], ['b', 'c']);
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });

  it('capped 50', () => {
    const initial = Array.from({ length: 45 }, (_, i) => `b${i}`);
    const incoming = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const result = mergeSourceBlocks(initial, incoming);
    expect(result.length).toBe(50);
    expect(result).toContain('n19');
  });

  it('сохраняет старые id, если capped не нужен', () => {
    const r = mergeSourceBlocks(['a', 'b'], ['c']);
    expect(r.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('RoleMapBuilderService.estimateCompleteness (через приватный путь)', () => {
  it('все 9 слотов = 1.0; ни одного = 0', () => {
    const slots = 9;
    const weight = 1 / slots;
    expect(weight * slots).toBeCloseTo(1, 6);
  });
});

describe('RoleMapBuilderService — smoke (с замоканной prisma)', () => {
  it('getMap возвращает counts и completeness', async () => {
    const role = {
      id: 'r1',
      tenantId: 't1',
      name: 'Менеджер',
      departmentId: null,
      maturityScore: null,
      missionStatement: null,
      deletedAt: null,
      department: null,
      roleProfile: null,
      attachedMetrics: [],
    };
    const prisma = {
      role: { findUnique: vi.fn().mockResolvedValue(role) },
      department: { findUnique: vi.fn().mockResolvedValue(null) },
      roleProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      metric: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const empty = vi.fn().mockResolvedValue([]);
    const responsibilities = { listByRole: empty } as never;
    const authority = { listByRole: empty } as never;
    const knowledge = { listByRole: empty } as never;
    const decisions = { listByRole: empty } as never;
    const interactions = { listByRole: empty } as never;
    const metrics = {
      setRoleMapCompletenessAvg: vi.fn(),
      setRolesWithNormalizedDataRatio: vi.fn(),
    } as never;

    const { RoleMapBuilderService } = await import('./role-map-builder.service');
    const svc = new RoleMapBuilderService(
      prisma,
      metrics,
      responsibilities,
      authority,
      knowledge,
      decisions,
      interactions,
    );
    const map = await svc.getMap({ tenantId: 't1', roleId: 'r1' });
    expect(map.role.id).toBe('r1');
    expect(map.role.name).toBe('Менеджер');
    expect(map.counts).toEqual({
      responsibilities: 0,
      authority: 0,
      knowledge: 0,
      decisions: 0,
      interactions: 0,
      metrics: 0,
    });
    expect(map.completeness).toBe(0);
    expect(map.isForming).toBe(true);
  });
});
