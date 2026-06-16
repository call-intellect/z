import { Prisma } from '@prisma/client';
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
  /**
   * Б6: живой COUNT(active) черт концепта, который вернёт skillTrait.count.
   * Default 0 — на момент attach/create новый trait ещё pending и не привязан.
   */
  activeTraitCount?: number;
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
    skillTrait: {
      update: vi.fn(async () => ({})),
      // Б6: единый источник истины traitCount = COUNT(active).
      count: vi.fn(async () => args.activeTraitCount ?? 0),
    },
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

  it('сценарий 1: точное совпадение по embedding (distance 0.0) — возвращает существующий, traitCount = live COUNT(active)', async () => {
    const existing = makeConcept({ id: 'existing-1', traitCount: 3 });
    // Б6: денормализованный traitCount=3 «дрейфовал», но живых active-черт — 5.
    const { svc, prisma, store } = buildService({
      matchDistance: 0.0,
      matchedConcept: existing,
      activeTraitCount: 5,
    });

    const result = await svc.findOrCreateConcept({
      tenantId: 't1',
      category: 'осторожен с оценками сроков',
      statement: 'Похоже, склонен подвергать сомнению ранние оценки сроков.',
    });

    expect(result?.id).toBe('existing-1');
    expect(prisma.skillTraitConcept.update).toHaveBeenCalledTimes(1);
    const updated = store.get('existing-1')!;
    // НЕ 3+1=4 (слепой инкремент), а живой COUNT(active)=5.
    expect(updated.traitCount).toBe(5);
    expect(prisma.skillTrait.count).toHaveBeenCalledTimes(1);
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
      activeTraitCount: 2, // живых active-черт ровно 2 (новая ещё pending)
    });

    const result = await svc.findOrCreateConcept({
      tenantId: 't1',
      category: 'не любит давать сроки без данных',
      statement: 'В большинстве случаев откладывает оценку до сбора фактов.',
    });

    expect(result?.id).toBe('existing-2');
    const updated = store.get('existing-2')!;
    expect(updated.variants).toContain('не любит давать сроки без данных');
    // traitCount = live COUNT(active)=2, а не слепой 2+1=3.
    expect(updated.traitCount).toBe(2);
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
    // Б6: новый концепт стартует с traitCount=0 (trait, ради которого создан,
    // ещё pending и не привязан) — не слепой 1.
    expect(result?.traitCount).toBe(0);
    const createData = (prisma.skillTraitConcept.create as any).mock.calls[0][0]
      .data;
    expect(createData.traitCount).toBe(0);
    // Старый концепт не изменился.
    expect(store.get('existing-3')!.traitCount).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Б8 (merge-canonical-name-unique-collision) + Б6 (recomputeTraitCount).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Builder под mergeConcepts: target + sources + опц. «занятое» новое имя.
 *
 * @param collisionConceptId — id концепта, уже носящего desiredName (вне merge).
 *   Если задан — pre-write findFirst найдёт коллизию и имя НЕ должно поменяться.
 * @param throwP2002Once — если true, первый update target бросает P2002 (гонка),
 *   ожидается retry без смены имени.
 */
function buildMergeService(opts: {
  collisionConceptId?: string;
  throwP2002Once?: boolean;
}) {
  const target = makeConcept({
    id: 'target',
    canonicalName: 'старое опорное имя',
    variants: ['старое опорное имя'],
    traitCount: 5,
  });
  const source = makeConcept({
    id: 'source',
    canonicalName: 'источник',
    variants: ['источник'],
    traitCount: 2,
  });

  let updateCalls = 0;
  const targetUpdateData: any[] = [];

  const tx = {
    skillTrait: {
      updateMany: vi.fn(async () => ({ count: 2 })),
      count: vi.fn(async () => 7),
    },
    skillTraitConcept: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: any) => {
        updateCalls++;
        targetUpdateData.push(data);
        if (opts.throwP2002Once && updateCalls === 1 && data.canonicalName) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'x',
          });
        }
        return { ...target, ...data };
      }),
    },
  };

  const prisma = {
    skillTraitConcept: {
      findUnique: vi.fn(async ({ where }: any) =>
        where?.id === 'target' ? target : null,
      ),
      findMany: vi.fn(async () => [source]),
      findFirst: vi.fn(async ({ where }: any) => {
        // pre-write коллизия по canonicalName.
        if (opts.collisionConceptId && where?.canonicalName) {
          return { id: opts.collisionConceptId };
        }
        return null;
      }),
      update: vi.fn(),
    },
    skillTrait: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  const embedder = { embedQuery: vi.fn() };
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
  return { svc, prisma, metrics, tx, targetUpdateData };
}

describe('SkillTraitConceptService.mergeConcepts (Б8 collision)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('новое имя свободно — merge проходит, имя меняется, возвращает true', async () => {
    const { svc, metrics, targetUpdateData } = buildMergeService({});

    const ok = await svc.mergeConcepts({
      tenantId: 't1',
      sourceIds: ['source'],
      targetId: 'target',
      newCanonicalName: 'новое каноническое имя',
    });

    expect(ok).toBe(true);
    expect(metrics.incSkillTraitConceptsMerged).toHaveBeenCalledTimes(1);
    expect(targetUpdateData.at(-1)!.canonicalName).toBe('новое каноническое имя');
  });

  it('новое имя занято ДРУГИМ концептом — имя НЕ меняется, merge всё равно проходит (true)', async () => {
    const { svc, metrics, targetUpdateData } = buildMergeService({
      collisionConceptId: 'other-concept',
    });

    const ok = await svc.mergeConcepts({
      tenantId: 't1',
      sourceIds: ['source'],
      targetId: 'target',
      newCanonicalName: 'занятое имя',
    });

    // Не silent no-op: слияние состоялось, метрика инкрементнута.
    expect(ok).toBe(true);
    expect(metrics.incSkillTraitConceptsMerged).toHaveBeenCalledTimes(1);
    // Имя не подменялось на занятое.
    expect(targetUpdateData.at(-1)!.canonicalName).toBeUndefined();
  });

  it('P2002 на имени (гонка) — retry без смены имени, merge проходит (true)', async () => {
    const { svc, metrics, targetUpdateData } = buildMergeService({
      throwP2002Once: true,
    });

    const ok = await svc.mergeConcepts({
      tenantId: 't1',
      sourceIds: ['source'],
      targetId: 'target',
      newCanonicalName: 'новое имя',
    });

    expect(ok).toBe(true);
    expect(metrics.incSkillTraitConceptsMerged).toHaveBeenCalledTimes(1);
    // Последний update — retry без имени.
    expect(targetUpdateData.at(-1)!.canonicalName).toBeUndefined();
  });

  it('коллизия — это один из sources (id ∈ merge) — не считается коллизией, имя меняется', async () => {
    const { svc, targetUpdateData } = buildMergeService({
      collisionConceptId: 'source', // id внутри merge-набора
    });

    const ok = await svc.mergeConcepts({
      tenantId: 't1',
      sourceIds: ['source'],
      targetId: 'target',
      newCanonicalName: 'имя источника',
    });

    expect(ok).toBe(true);
    expect(targetUpdateData.at(-1)!.canonicalName).toBe('имя источника');
  });

  it('транзакция упала (не-P2002) — возвращает false, метрика не инкрементится', async () => {
    const { svc, prisma, metrics } = buildMergeService({});
    (prisma.$transaction as any).mockRejectedValue(new Error('db down'));

    const ok = await svc.mergeConcepts({
      tenantId: 't1',
      sourceIds: ['source'],
      targetId: 'target',
      newCanonicalName: 'имя',
    });

    expect(ok).toBe(false);
    expect(metrics.incSkillTraitConceptsMerged).not.toHaveBeenCalled();
  });
});

describe('SkillTraitConceptService.recomputeTraitCount (Б6)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('персистит COUNT(active) и возвращает его', async () => {
    const updateMock = vi.fn(async () => ({}));
    const prisma = {
      skillTrait: { count: vi.fn(async () => 4) },
      skillTraitConcept: { update: updateMock },
    } as any;
    const svc = new SkillTraitConceptService(
      prisma,
      { embedQuery: vi.fn() } as any,
      { skill: {} } as any,
      {} as any,
    );

    const count = await svc.recomputeTraitCount('c-1');

    expect(count).toBe(4);
    expect(prisma.skillTrait.count).toHaveBeenCalledWith({
      where: { conceptId: 'c-1', status: 'active' },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { traitCount: 4 },
    });
  });

  it('сбой update — возвращает null, не бросает', async () => {
    const prisma = {
      skillTrait: { count: vi.fn(async () => 2) },
      skillTraitConcept: {
        update: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
    } as any;
    const svc = new SkillTraitConceptService(
      prisma,
      { embedQuery: vi.fn() } as any,
      { skill: {} } as any,
      {} as any,
    );

    await expect(svc.recomputeTraitCount('c-1')).resolves.toBeNull();
  });
});
