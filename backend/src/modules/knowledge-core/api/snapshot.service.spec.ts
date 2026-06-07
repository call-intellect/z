/**
 * KC-Temporal W1.3 (2026-05-25) — unit-тесты `SnapshotService`.
 *
 * Мокаем PrismaService — проверяем поведение bi-temporal-фильтра, truncation,
 * подгрузку evidence/entities. Полный e2e с реальной БД покроет integration-spec
 * на этапе W1.6 (acceptance suite).
 *
 * DoD из ТЗ §W1.3:
 *   - Контрактный тест: `snapshot(at=now)` ≡ выборка без temporal-фильтра.
 *   - `snapshot(at=block.createdAt - 1s)` НЕ возвращает блок.
 *   - `limit` соблюдается, `truncated=true` при превышении.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  KnowledgeAccessContext,
  KnowledgeAccessResolver,
} from '../../rbac/knowledge-access-resolver.service';

import { SnapshotService } from './snapshot.service';

/**
 * Ф4 (knowledge-access) — фабрики DI-заглушек. По умолчанию режим гейта `off`,
 * поэтому accessResolver/metrics НЕ должны вызываться (поведение байт-в-байт).
 */
function makeCfg(
  enforcement: 'off' | 'shadow' | 'enforce' = 'off',
): TypedConfigService {
  return {
    knowledgeAccess: { enforcement },
  } as unknown as TypedConfigService;
}

function makeResolver(overrides: Partial<KnowledgeAccessResolver> = {}): {
  resolver: KnowledgeAccessResolver;
  resolveSpy: ReturnType<typeof vi.fn>;
  buildWhereSpy: ReturnType<typeof vi.fn>;
  partitionSpy: ReturnType<typeof vi.fn>;
} {
  const resolveSpy = vi.fn(
    async (): Promise<KnowledgeAccessContext> => ({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    }),
  );
  const buildWhereSpy = vi.fn(() => ({ blockAccessGate: true }));
  const partitionSpy = vi.fn(async (_ctx: unknown, ids: string[]) => ({
    accessible: ids,
    denied: 0,
  }));
  const resolver = {
    resolveAccessibleGroups: resolveSpy,
    buildAccessWhere: buildWhereSpy,
    partitionBlockIdsByAccess: partitionSpy,
    ...overrides,
  } as unknown as KnowledgeAccessResolver;
  return { resolver, resolveSpy, buildWhereSpy, partitionSpy };
}

function makeMetrics(): {
  metrics: BusinessMetricsService;
  shadowSpy: ReturnType<typeof vi.fn>;
} {
  const shadowSpy = vi.fn();
  const metrics = {
    incAccessShadowDiff: shadowSpy,
    incAccessDenied: vi.fn(),
  } as unknown as BusinessMetricsService;
  return { metrics, shadowSpy };
}

/** Конструктор сервиса со стандартными off-заглушками (для legacy-тестов). */
function makeService(prisma: PrismaService): SnapshotService {
  return new SnapshotService(
    prisma,
    makeCfg('off'),
    makeResolver().resolver,
    makeMetrics().metrics,
  );
}


interface FakeBlock {
  id: string;
  tenantId: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: string[];
  signalType: string;
  status: string;
  confidence: Prisma.Decimal;
  evidenceCount: number;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeLink {
  id: string;
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  fromType: string | null;
  toType: string | null;
  relationType: string;
  status: string;
  deletedAt: Date | null;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeBlock(overrides: Partial<FakeBlock> = {}): FakeBlock {
  const now = new Date('2026-05-25T10:00:00Z');
  return {
    id: overrides.id ?? 'b-1',
    tenantId: overrides.tenantId ?? 't-A',
    name: 'block',
    criticalQuestion: 'q?',
    trustedAnswer: 'a.',
    tags: [],
    signalType: 'idea',
    status: 'canonical',
    confidence: new Prisma.Decimal(0.7),
    evidenceCount: 0,
    validFrom: null,
    validUntil: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeLink(overrides: Partial<FakeLink> = {}): FakeLink {
  const now = new Date('2026-05-25T10:00:00Z');
  return {
    id: overrides.id ?? 'l-1',
    tenantId: overrides.tenantId ?? 't-A',
    fromEntityId: 'e-1',
    toEntityId: 'e-2',
    fromType: 'entity',
    toType: 'entity',
    relationType: 'related_to',
    status: 'active',
    deletedAt: null,
    validFrom: now,
    validUntil: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Лёгкий fake PrismaService: имитирует `findMany` по in-memory массивам
 * + применяет нужные нам фильтры (tenantId, status, validFrom/Until,
 * signalType, entities.some, OR for links). Не претендует на полноту —
 * только то, что использует `SnapshotService.buildBlockWhere/buildLinkWhere`.
 */
function buildFakePrisma(opts: {
  blocks: FakeBlock[];
  links: FakeLink[];
  evidence?: Array<{
    id: string;
    blockId: string;
    rawEventId: string;
    sourceType: string;
    sourceTimestamp: Date | null;
    quote: string;
    startMs: number | null;
    endMs: number | null;
    createdAt: Date;
  }>;
  blockEntities?: Array<{
    blockId: string;
    entityId: string;
    createdAt: Date;
    entity: {
      id: string;
      type: string;
      canonicalName: string;
      aliases: string[];
      mentionsCount: number;
      metadata: unknown;
    };
  }>;
}): PrismaService {
  return {
    ideaBlock: {
      findMany: vi.fn(async (args: { where?: any; take?: number }) => {
        const w = args?.where ?? {};
        const filtered = opts.blocks.filter((b) => {
          if (w.tenantId && b.tenantId !== w.tenantId) return false;
          if (w.status && b.status !== w.status) return false;
          if (w.signalType?.in) {
            if (!w.signalType.in.includes(b.signalType)) return false;
          }
          // Bi-temporal AND: [{OR validFrom null|<=at}, {OR validUntil null|>at}]
          if (Array.isArray(w.AND)) {
            const at = extractAt(w.AND);
            if (at) {
              if (b.validFrom !== null && b.validFrom > at) return false;
              if (b.validUntil !== null && b.validUntil <= at) return false;
            }
          }
          if (w.entities?.some?.entityId) {
            const want = w.entities.some.entityId;
            const has = (opts.blockEntities ?? []).some(
              (be) => be.blockId === b.id && be.entityId === want,
            );
            if (!has) return false;
          }
          return true;
        });
        return args?.take ? filtered.slice(0, args.take) : filtered;
      }),
    },
    entityLink: {
      findMany: vi.fn(async (args: { where?: any; take?: number }) => {
        const w = args?.where ?? {};
        const filtered = opts.links.filter((l) => {
          if (w.tenantId && l.tenantId !== w.tenantId) return false;
          if (w.status && l.status !== w.status) return false;
          if (w.deletedAt === null && l.deletedAt !== null) return false;
          if (Array.isArray(w.AND)) {
            const at = extractAtLink(w.AND);
            if (at) {
              if (l.validFrom > at) return false;
              if (l.validUntil !== null && l.validUntil <= at) return false;
            }
          }
          if (Array.isArray(w.OR)) {
            const ids = new Set<string>();
            for (const cond of w.OR) {
              if (cond.fromEntityId) ids.add(cond.fromEntityId);
              if (cond.toEntityId) ids.add(cond.toEntityId);
            }
            const touches =
              ids.has(l.fromEntityId) || ids.has(l.toEntityId);
            if (!touches) return false;
          }
          return true;
        });
        return args?.take ? filtered.slice(0, args.take) : filtered;
      }),
    },
    ideaBlockEvidence: {
      findMany: vi.fn(async (args: { where?: any }) => {
        const ids: string[] = args?.where?.blockId?.in ?? [];
        return (opts.evidence ?? []).filter((e) => ids.includes(e.blockId));
      }),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async (args: { where?: any }) => {
        const ids: string[] = args?.where?.blockId?.in ?? [];
        return (opts.blockEntities ?? []).filter((r) =>
          ids.includes(r.blockId),
        );
      }),
    },
  } as unknown as PrismaService;
}

function extractAt(and: any[]): Date | null {
  // ищем `{ OR: [{ validFrom: null }, { validFrom: { lte: Date } }] }`
  for (const clause of and) {
    if (clause?.OR) {
      for (const sub of clause.OR) {
        if (sub?.validFrom?.lte instanceof Date) return sub.validFrom.lte;
      }
    }
  }
  return null;
}

function extractAtLink(and: any[]): Date | null {
  for (const clause of and) {
    if (clause?.validFrom?.lte instanceof Date) return clause.validFrom.lte;
  }
  return null;
}

describe('SnapshotService.getSnapshot — bi-temporal-срез', () => {
  it('asOf=now: возвращает блок с validFrom=null,validUntil=null (legacy)', async () => {
    const block = makeBlock({ id: 'b-active' });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const svc = makeService(prisma);
    const at = new Date('2026-05-25T12:00:00Z');

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at,
      limit: 100,
    });

    expect(res.asOf).toBe(at.toISOString());
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]!.block.id).toBe('b-active');
    expect(res.truncated).toBe(false);
    expect(typeof res.tookMs).toBe('number');
  });

  it('asOf < validFrom → блок НЕ возвращается', async () => {
    const validFrom = new Date('2026-05-25T10:00:00Z');
    const block = makeBlock({ id: 'b-future', validFrom });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const svc = makeService(prisma);

    const beforeBirth = new Date(validFrom.getTime() - 1000);
    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: beforeBirth,
      limit: 100,
    });

    expect(res.blocks).toHaveLength(0);
  });

  it('asOf >= validUntil → блок НЕ возвращается (факт устарел)', async () => {
    const validFrom = new Date('2026-05-01T00:00:00Z');
    const validUntil = new Date('2026-05-20T00:00:00Z');
    const block = makeBlock({ id: 'b-expired', validFrom, validUntil });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date('2026-05-25T00:00:00Z'),
      limit: 100,
    });

    expect(res.blocks).toHaveLength(0);
  });

  it('asOf внутри [validFrom, validUntil) — блок возвращается', async () => {
    const block = makeBlock({
      id: 'b-window',
      validFrom: new Date('2026-05-01T00:00:00Z'),
      validUntil: new Date('2026-06-01T00:00:00Z'),
    });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date('2026-05-25T00:00:00Z'),
      limit: 100,
    });

    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]!.block.id).toBe('b-window');
  });

  it('limit соблюдается, truncated=true при превышении', async () => {
    const blocks = Array.from({ length: 5 }, (_, i) =>
      makeBlock({ id: `b-${i}` }),
    );
    const prisma = buildFakePrisma({ blocks, links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      limit: 3,
    });

    expect(res.blocks).toHaveLength(3);
    expect(res.truncated).toBe(true);
  });

  it('truncated=false если block ровно limit', async () => {
    const blocks = Array.from({ length: 3 }, (_, i) =>
      makeBlock({ id: `b-${i}` }),
    );
    const prisma = buildFakePrisma({ blocks, links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      limit: 3,
    });

    expect(res.blocks).toHaveLength(3);
    expect(res.truncated).toBe(false);
  });

  it('entityLinks: активная связь возвращается, истёкшая — нет', async () => {
    const active = makeLink({
      id: 'l-active',
      validFrom: new Date('2026-05-01T00:00:00Z'),
      validUntil: null,
    });
    const expired = makeLink({
      id: 'l-expired',
      validFrom: new Date('2026-04-01T00:00:00Z'),
      validUntil: new Date('2026-05-10T00:00:00Z'),
    });
    const prisma = buildFakePrisma({
      blocks: [],
      links: [active, expired],
    });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date('2026-05-25T00:00:00Z'),
      limit: 100,
    });

    expect(res.entityLinks).toHaveLength(1);
    expect(res.entityLinks[0]!.id).toBe('l-active');
  });

  it('entityId-фильтр: блок c упоминанием entity подтягивается, без — нет', async () => {
    const b1 = makeBlock({ id: 'b-1' });
    const b2 = makeBlock({ id: 'b-2' });
    const prisma = buildFakePrisma({
      blocks: [b1, b2],
      links: [],
      blockEntities: [
        {
          blockId: 'b-1',
          entityId: 'e-X',
          createdAt: new Date(),
          entity: {
            id: 'e-X',
            type: 'project',
            canonicalName: 'X',
            aliases: [],
            mentionsCount: 1,
            metadata: null,
          },
        },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      entityId: 'e-X',
      limit: 100,
    });

    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]!.block.id).toBe('b-1');
    expect(res.blocks[0]!.entities).toHaveLength(1);
    expect(res.blocks[0]!.entities[0]!.id).toBe('e-X');
  });

  it('signalTypes-фильтр прокидывается в Prisma WHERE', async () => {
    const b1 = makeBlock({ id: 'b-ins', signalType: 'idea' });
    const b2 = makeBlock({ id: 'b-dec', signalType: 'decision' });
    const prisma = buildFakePrisma({ blocks: [b1, b2], links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      signalTypes: ['decision'],
      limit: 100,
    });

    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]!.block.id).toBe('b-dec');
  });

  it('контракт: at=now ≡ выборка без temporal-фильтра (все активные блоки tenant)', async () => {
    // Все три блока — активные (validUntil null), значит на любом at должны
    // вернуться все. Это инвариант «snapshot(now) == текущий стейт».
    const blocks = [
      makeBlock({ id: 'b-a' }),
      makeBlock({ id: 'b-b' }),
      makeBlock({ id: 'b-c' }),
    ];
    const prisma = buildFakePrisma({ blocks, links: [] });
    const svc = makeService(prisma);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      limit: 100,
    });

    expect(res.blocks).toHaveLength(3);
    expect(res.blocks.map((x) => x.block.id).sort()).toEqual([
      'b-a',
      'b-b',
      'b-c',
    ]);
  });
});

describe('SnapshotService — Ф4 гейт доступа (knowledge-access)', () => {
  it('off: resolver НЕ вызывается, where без access-фрагмента (байт-в-байт)', async () => {
    const block = makeBlock({ id: 'b-1' });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const findManySpy = prisma.ideaBlock.findMany as ReturnType<typeof vi.fn>;
    const { resolver, resolveSpy } = makeResolver();
    const { metrics, shadowSpy } = makeMetrics();
    const svc = new SnapshotService(prisma, makeCfg('off'), resolver, metrics);

    await svc.getSnapshot({ tenantId: 't-A', userId: 'u-1', at: new Date(), limit: 100 });

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(shadowSpy).not.toHaveBeenCalled();
    // where.AND содержит ровно 2 bi-temporal-условия, без access-gate.
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't-A',
          status: 'canonical',
          AND: expect.not.arrayContaining([
            expect.objectContaining({ blockAccessGate: true }),
          ]),
        }),
      }),
    );
  });

  it('enforce: where.AND содержит фрагмент buildAccessWhere', async () => {
    const block = makeBlock({ id: 'b-1' });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const findManySpy = prisma.ideaBlock.findMany as ReturnType<typeof vi.fn>;
    const { resolver, resolveSpy, buildWhereSpy } = makeResolver();
    const { metrics } = makeMetrics();
    const svc = new SnapshotService(prisma, makeCfg('enforce'), resolver, metrics);

    await svc.getSnapshot({ tenantId: 't-A', userId: 'u-1', at: new Date(), limit: 100 });

    expect(resolveSpy).toHaveBeenCalledWith({ tenantId: 't-A', userId: 'u-1' });
    expect(buildWhereSpy).toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ blockAccessGate: true }),
          ]),
        }),
      }),
    );
  });

  it('enforce + bypass: where без access-фрагмента (owner видит всё)', async () => {
    const block = makeBlock({ id: 'b-1' });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const findManySpy = prisma.ideaBlock.findMany as ReturnType<typeof vi.fn>;
    const { resolver, buildWhereSpy } = makeResolver({
      resolveAccessibleGroups: vi.fn(
        async (): Promise<KnowledgeAccessContext> => ({
          deptGroupIds: [],
          closedGroupIds: [],
          isBypass: true,
        }),
      ) as unknown as KnowledgeAccessResolver['resolveAccessibleGroups'],
    });
    const { metrics } = makeMetrics();
    const svc = new SnapshotService(prisma, makeCfg('enforce'), resolver, metrics);

    await svc.getSnapshot({ tenantId: 't-A', userId: 'u-1', at: new Date(), limit: 100 });

    expect(buildWhereSpy).not.toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.not.arrayContaining([
            expect.objectContaining({ blockAccessGate: true }),
          ]),
        }),
      }),
    );
  });

  it('shadow: выдача не меняется, считается метрика denied', async () => {
    const block = makeBlock({ id: 'b-1' });
    const prisma = buildFakePrisma({ blocks: [block], links: [] });
    const partitionSpy = vi.fn(async (_ctx: unknown, ids: string[]) => ({
      accessible: ids,
      denied: 1,
    }));
    const { resolver } = makeResolver({
      partitionBlockIdsByAccess:
        partitionSpy as unknown as KnowledgeAccessResolver['partitionBlockIdsByAccess'],
    });
    const { metrics, shadowSpy } = makeMetrics();
    const svc = new SnapshotService(prisma, makeCfg('shadow'), resolver, metrics);

    const res = await svc.getSnapshot({
      tenantId: 't-A',
      userId: 'u-1',
      at: new Date(),
      limit: 100,
    });

    // Выдача НЕ меняется (блок остаётся).
    expect(res.blocks).toHaveLength(1);
    expect(partitionSpy).toHaveBeenCalled();
    expect(shadowSpy).toHaveBeenCalledWith({ surface: 'snapshot' }, 1);
  });
});
