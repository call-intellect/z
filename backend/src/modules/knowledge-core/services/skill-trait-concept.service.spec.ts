import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillTraitConceptService } from './skill-trait-concept.service';

/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — юнит-тесты
 * SkillTraitConceptService.findOrCreateConcept.
 *
 * Покрываемые сценарии:
 *   1. Точное совпадение по embedding (similarity 1.0) → возвращает существующий.
 *   2. Близкое по embedding (similarity 0.87) → возвращает существующий + variants растёт.
 *   3. Далёкое (similarity 0.5) → создаёт новый концепт.
 *
 * Vector-search замокан: `$queryRawUnsafe` возвращает кандидата с заданной
 * `distance`. Сервис сравнивает её с `cfg.skill.conceptMatchThreshold=0.85`
 * (distance <= 0.15 → match).
 */

interface FakeConcept {
  id: string;
  tenantId: string;
  canonicalName: string;
  description: string | null;
  variants: string[];
  status: 'active' | 'merged_into' | 'archived';
  mergedIntoId: string | null;
  traitCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function makeConcept(overrides: Partial<FakeConcept> = {}): FakeConcept {
  return {
    id: 'c1',
    tenantId: 't1',
    canonicalName: 'осторожен с оценками сроков',
    description: null,
    variants: ['осторожен с оценками сроков'],
    status: 'active',
    mergedIntoId: null,
    traitCount: 1,
    firstSeenAt: new Date('2026-01-01'),
    lastSeenAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function buildService(args: {
  /** distance, который вернёт $queryRawUnsafe (если concepts есть). */
  matchDistance: number | null;
  /** concept, который вернётся как top-1 (если matchDistance != null). */
  matchedConcept: FakeConcept | null;
}) {
  const store = new Map<string, FakeConcept>();
  if (args.matchedConcept) store.set(args.matchedConcept.id, args.matchedConcept);

  const prisma = {
    $queryRawUnsafe: vi.fn(async () => {
      if (args.matchDistance == null || !args.matchedConcept) return [];
      return [{ id: args.matchedConcept.id, distance: args.matchDistance }];
    }),
    $executeRawUnsafe: vi.fn(async () => 1),
    skillTraitConcept: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where?.id) return store.get(where.id) ?? null;
        if (where?.tenantId_canonicalName) {
          const k = where.tenantId_canonicalName;
          for (const c of store.values()) {
            if (c.tenantId === k.tenantId && c.canonicalName === k.canonicalName) {
              return c;
            }
          }
          return null;
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const cur = store.get(where.id);
        if (!cur) throw new Error('not found');
        const next = { ...cur, ...data, updatedAt: new Date() };
        store.set(where.id, next);
        return next;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = data.id ?? `new-${store.size + 1}`;
        const created: FakeConcept = makeConcept({
          id,
          tenantId: data.tenantId,
          canonicalName: data.canonicalName,
          variants: data.variants ?? [data.canonicalName],
          traitCount: data.traitCount ?? 1,
          status: data.status ?? 'active',
        });
        store.set(id, created);
        return created;
      }),
    },
    skillTrait: { update: vi.fn(async () => ({})) },
  };
  const embedder = {
    embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
  };
  const cfg = {
    skill: {
      conceptMatchThreshold: 0.85,
      conceptMergeThreshold: 0.92,
      conceptArchiveAfterMonths: 6,
    },
  } as any;
  const metrics = {
    incSkillTraitConceptsMerged: vi.fn(),
    setSkillTraitConceptsTotal: vi.fn(),
  } as any;
  const svc = new SkillTraitConceptService(
    prisma as any,
    embedder as any,
    cfg,
    metrics,
  );
  return { svc, prisma, embedder, store };
}

describe('SkillTraitConceptService.findOrCreateConcept', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('сценарий 1: точное совпадение по embedding (distance 0.0) — возвращает существующий', async () => {
    const existing = makeConcept({ id: 'existing-1', traitCount: 3 });
    const { svc, prisma, store } = buildService({
      matchDistance: 0.0,
      matchedConcept: existing,
    });

    const result = await svc.findOrCreateConcept({
      tenantId: 't1',
      category: 'осторожен с оценками сроков',
      statement: 'Похоже, склонен подвергать сомнению ранние оценки сроков.',
    });

    expect(result?.id).toBe('existing-1');
    expect(prisma.skillTraitConcept.update).toHaveBeenCalledTimes(1);
    const updated = store.get('existing-1')!;
    expect(updated.traitCount).toBe(4);
    expect(prisma.skillTraitConcept.create).not.toHaveBeenCalled();
  });

  it('сценарий 2: близкое по embedding (similarity 0.87, distance 0.13) — возвращает существующий и расширяет variants', async () => {
    const existing = makeConcept({
      id: 'existing-2',
      canonicalName: 'осторожен с оценками сроков',
      variants: ['осторожен с оценками сроков'],
      traitCount: 2,
    });
    const { svc, store } = buildService({
      matchDistance: 0.13, // similarity 0.87 >= 0.85
      matchedConcept: existing,
    });

    const result = await svc.findOrCreateConcept({
      tenantId: 't1',
      category: 'не любит давать сроки без данных',
      statement: 'В большинстве случаев откладывает оценку до сбора фактов.',
    });

    expect(result?.id).toBe('existing-2');
    const updated = store.get('existing-2')!;
    expect(updated.variants).toContain('не любит давать сроки без данных');
    expect(updated.traitCount).toBe(3);
  });

  it('сценарий 3: далёкое по embedding (similarity 0.50, distance 0.50) — создаёт новый концепт', async () => {
    const existing = makeConcept({
      id: 'existing-3',
      canonicalName: 'осторожен с оценками сроков',
    });
    const { svc, prisma, store } = buildService({
      matchDistance: 0.50, // similarity 0.50 < 0.85
      matchedConcept: existing,
    });

    const result = await svc.findOrCreateConcept({
      tenantId: 't1',
      category: 'делегирует ранние решения',
      statement: 'Похоже, склонен оставлять ранние развилки на исполнителей.',
    });

    expect(result?.canonicalName).toBe('делегирует ранние решения');
    expect(prisma.skillTraitConcept.create).toHaveBeenCalledTimes(1);
    // Старый концепт не изменился.
    expect(store.get('existing-3')!.traitCount).toBe(1);
  });
});
