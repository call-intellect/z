import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillEntityTenantCompanions } from '../../../../scripts/backfill-entity-tenant-companions';
import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import {
  buildKnowledgeCoreFixture,
  cleanupByPrefix,
} from '../../../../test/integration/knowledge-core/fixtures';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { EntityMergeService } from './entity-merge.service';

const PREFIX = 'kc-entmerge-spec';

interface Ctx {
  dbReady: boolean;
  svc: EntityMergeService | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}
const ctx: Ctx = { dbReady: false, svc: null, fixture: null };

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  const prisma = await getPrismaClient();
  ctx.fixture = await buildKnowledgeCoreFixture(prisma, PREFIX);
  ctx.svc = new EntityMergeService(
    prisma as unknown as PrismaService,
    null as unknown as LlmRouterService,
    undefined,
  );
});

afterAll(async () => {
  if (ctx.fixture) await ctx.fixture.cleanup();
  const prisma = await getPrismaClient().catch(() => null);
  if (prisma) await cleanupByPrefix(prisma, PREFIX);
  await closePrismaClient();
});

function skipIfNoDb(testCtx: { skip: () => void }): boolean {
  if (!ctx.dbReady) {
    testCtx.skip();
    return true;
  }
  return false;
}

async function seedMergePair(suffix: string): Promise<{
  tenantId: string;
  aId: string;
  bId: string;
  cId: string;
  blockId: string;
  rawEventId: string;
  themeId: string;
  ownerCardId: string;
  relatedCardId: string;
  personId: string;
  linkedEntityId: string;
  entityLinkId: string;
}> {
  const f = ctx.fixture!;
  const prisma = await getPrismaClient();
  const tenantId = f.orgAId;

  const aId = `${PREFIX}-${suffix}-A`;
  const bId = `${PREFIX}-${suffix}-B`;
  const cId = `${PREFIX}-${suffix}-C`;
  const linkedEntityId = `${PREFIX}-${suffix}-D`;
  const blockId = `${PREFIX}-${suffix}-blk`;
  const rawEventId = `${PREFIX}-${suffix}-raw`;
  const themeId = `${PREFIX}-${suffix}-theme`;
  const ownerCardId = `${PREFIX}-${suffix}-card-owner`;
  const relatedCardId = `${PREFIX}-${suffix}-card-related`;
  const personId = `${PREFIX}-${suffix}-person`;

  await prisma.entity.createMany({
    data: [
      { id: aId, tenantId, type: 'topic', canonicalName: `A ${suffix}`, aliases: ['a-alias'], mentionsCount: 3 },
      { id: bId, tenantId, type: 'topic', canonicalName: `B ${suffix}`, aliases: ['b-alias'], mentionsCount: 5 },
      { id: cId, tenantId, type: 'topic', canonicalName: `C ${suffix}`, aliases: [], mentionsCount: 1 },
      { id: linkedEntityId, tenantId, type: 'topic', canonicalName: `D ${suffix}`, aliases: [], mentionsCount: 1 },
    ],
  });

  await prisma.ideaBlock.create({
    data: {
      id: blockId,
      tenantId,
      name: `Блок ${suffix}`,
      criticalQuestion: 'q?',
      trustedAnswer: 'a',
      signalType: 'fact',
      status: 'canonical',
      evidenceCount: 1,
    },
  });
  await prisma.ideaBlockEntity.create({
    data: { tenantId, blockId, entityId: aId, mentionContext: `${suffix} ctx` },
  });

  await prisma.rawEvent.create({
    data: {
      id: rawEventId,
      tenantId,
      sourceId: f.sourceAId,
      sourceType: 'meeting',
      sourceExternalId: `${PREFIX}-${suffix}-ext`,
      idempotencyKey: `${PREFIX}-${suffix}-idem`,
      occurredAt: new Date('2026-05-01T10:00:00Z'),
      payload: { fixture: suffix },
      payloadChecksum: `${PREFIX}-${suffix}-checksum`,
      payloadSizeBytes: 16,
      dataClass: 'internal',
    },
  });
  await prisma.sourceEntity.create({
    data: { rawEventId, entityId: aId, tenantId, mentionsCount: 4 },
  });

  await prisma.theme.create({
    data: { id: themeId, tenantId, name: `Тема ${suffix}`, description: 'fx', status: 'active' },
  });
  await prisma.themeEntity.create({
    data: { tenantId, themeId, entityId: aId, mentionsCount: 2 },
  });

  const entityLink = await prisma.entityLink.create({
    data: {
      tenantId,
      fromEntityId: aId,
      toEntityId: linkedEntityId,
      relationType: 'mentions_with',
      confidence: 0.5,
      explanation: `${suffix} link`,
      createdBy: 'system',
    },
  });

  await prisma.card.create({
    data: {
      id: ownerCardId,
      tenantId,
      ownerId: f.userOwnerAId,
      name: `Card owner ${suffix}`,
      entityId: aId,
      entityTenantId: tenantId,
    },
  });
  await prisma.card.create({
    data: {
      id: relatedCardId,
      tenantId,
      ownerId: f.userOwnerAId,
      name: `Card related ${suffix}`,
      relatedEntityIds: [aId, cId],
    },
  });

  await prisma.person.create({
    data: {
      id: personId,
      tenantId,
      name: `Person ${suffix}`,
      email: `${PREFIX}-${suffix}-person@test.local`,
      entityId: aId,
      entityTenantId: tenantId,
    },
  });

  await prisma.customerRiskSnapshot.create({
    data: {
      id: `${PREFIX}-${suffix}-risk`,
      tenantId,
      customerEntityId: aId,
      dateLocal: '2026-07-03',
      signalCounts: {},
      riskScore: 1,
      riskLevel: 'ok',
      topBlockIdsJson: [],
    },
  });

  await prisma.themeExclusion.create({
    data: {
      id: `${PREFIX}-${suffix}-excl`,
      tenantId,
      themeId,
      kind: 'entity',
      entityId: aId,
    },
  });

  return {
    tenantId,
    aId,
    bId,
    cId,
    blockId,
    rawEventId,
    themeId,
    ownerCardId,
    relatedCardId,
    personId,
    linkedEntityId,
    entityLinkId: entityLink.id,
  };
}

async function cleanupMergePair(): Promise<void> {
  const prisma = await getPrismaClient();
  await prisma.customerRiskSnapshot.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.themeExclusion.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.person.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.card.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.entityLink.deleteMany({ where: { explanation: { startsWith: PREFIX } } }).catch(() => undefined);
  await prisma.sourceEntity.deleteMany({ where: { rawEventId: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.themeEntity.deleteMany({ where: { themeId: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.theme.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.ideaBlockEntity.deleteMany({ where: { blockId: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.ideaBlock.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.rawEvent.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
  await prisma.entity.deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } }).catch(() => undefined);
}

describe('EntityMergeService.mergeEntities (integration)', () => {
  afterAll(async () => {
    if (ctx.dbReady) await cleanupMergePair();
  });

  it('мигрирует ВСЕ ссылки from→into и ставит companion mergedInto', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = await getPrismaClient();
    const s = await seedMergePair('all');

    await ctx.svc!.mergeEntities({ tenantId: s.tenantId, fromEntityId: s.aId, intoEntityId: s.bId });

    const a = await prisma.entity.findUnique({
      where: { id_tenantId: { id: s.aId, tenantId: s.tenantId } },
      include: { mergedInto: true },
    });
    expect(a?.mergedIntoId).toBe(s.bId);
    expect(a?.mergedIntoTenantId).toBe(s.tenantId);
    expect(a?.mergedInto).not.toBeNull();
    expect(a?.mergedInto?.id).toBe(s.bId);

    const ibe = await prisma.ideaBlockEntity.findMany({ where: { blockId: s.blockId } });
    expect(ibe.every((r) => r.entityId === s.bId)).toBe(true);
    expect(ibe.some((r) => r.entityId === s.aId)).toBe(false);

    const se = await prisma.sourceEntity.findMany({ where: { rawEventId: s.rawEventId } });
    expect(se.every((r) => r.entityId === s.bId)).toBe(true);
    expect(se.some((r) => r.entityId === s.aId)).toBe(false);

    const te = await prisma.themeEntity.findMany({ where: { themeId: s.themeId } });
    expect(te.every((r) => r.entityId === s.bId)).toBe(true);
    expect(te.some((r) => r.entityId === s.aId)).toBe(false);

    const link = await prisma.entityLink.findUnique({ where: { id: s.entityLinkId } });
    expect(link?.fromEntityId).toBe(s.bId);

    const ownerCard = await prisma.card.findUnique({ where: { id: s.ownerCardId } });
    expect(ownerCard?.entityId).toBe(s.bId);
    expect(ownerCard?.entityTenantId).toBe(s.tenantId);

    const relatedCard = await prisma.card.findUnique({ where: { id: s.relatedCardId } });
    expect(relatedCard?.relatedEntityIds).toContain(s.bId);
    expect(relatedCard?.relatedEntityIds).not.toContain(s.aId);
    expect(relatedCard?.relatedEntityIds).toContain(s.cId);

    const person = await prisma.person.findUnique({ where: { id: s.personId } });
    expect(person?.entityId).toBe(s.bId);
    expect(person?.entityTenantId).toBe(s.tenantId);

    const risk = await prisma.customerRiskSnapshot.findMany({
      where: { id: { startsWith: `${PREFIX}-all-` } },
    });
    expect(risk.every((r) => r.customerEntityId === s.bId)).toBe(true);
    expect(risk.some((r) => r.customerEntityId === s.aId)).toBe(false);

    const excl = await prisma.themeExclusion.findMany({
      where: { id: { startsWith: `${PREFIX}-all-` } },
    });
    expect(excl.every((r) => r.entityId === s.bId)).toBe(true);
    expect(excl.some((r) => r.entityId === s.aId)).toBe(false);

    const into = await prisma.entity.findUnique({
      where: { id_tenantId: { id: s.bId, tenantId: s.tenantId } },
    });
    expect(into?.mentionsCount).toBe(8);
    expect(into?.aliases).toContain(`A all`);
    expect(into?.aliases).toContain('a-alias');
  });

  it('уплощает цепочку: C(mergedInto=A), merge A→B ⇒ C.mergedInto=B', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = await getPrismaClient();
    const s = await seedMergePair('chain');

    await prisma.entity.update({
      where: { id_tenantId: { id: s.cId, tenantId: s.tenantId } },
      data: { mergedIntoId: s.aId, mergedIntoTenantId: s.tenantId },
    });

    await ctx.svc!.mergeEntities({ tenantId: s.tenantId, fromEntityId: s.aId, intoEntityId: s.bId });

    const c = await prisma.entity.findUnique({
      where: { id_tenantId: { id: s.cId, tenantId: s.tenantId } },
    });
    expect(c?.mergedIntoId).toBe(s.bId);
    expect(c?.mergedIntoTenantId).toBe(s.tenantId);
  });
});

describe('EntityMergeService.reconcileEntityRefs (integration)', () => {
  afterAll(async () => {
    if (ctx.dbReady) await cleanupMergePair();
  });

  it('перепривязывает осиротевшие ссылки со слитой F на канон C и идемпотентен', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = await getPrismaClient();
    const s = await seedMergePair('recon');
    const F = s.aId;
    const C = s.cId;

    await prisma.entity.update({
      where: { id_tenantId: { id: F, tenantId: s.tenantId } },
      data: { mergedIntoId: C, mergedIntoTenantId: s.tenantId },
    });

    const first = await ctx.svc!.reconcileEntityRefs(s.tenantId);
    expect(first.reconciled).toBeGreaterThanOrEqual(1);

    const assertHealed = async (): Promise<void> => {
      const ibe = await prisma.ideaBlockEntity.findMany({ where: { blockId: s.blockId } });
      expect(ibe.every((r) => r.entityId === C)).toBe(true);
      expect(ibe.some((r) => r.entityId === F)).toBe(false);

      const se = await prisma.sourceEntity.findMany({ where: { rawEventId: s.rawEventId } });
      expect(se.every((r) => r.entityId === C)).toBe(true);
      expect(se.some((r) => r.entityId === F)).toBe(false);

      const te = await prisma.themeEntity.findMany({ where: { themeId: s.themeId } });
      expect(te.every((r) => r.entityId === C)).toBe(true);
      expect(te.some((r) => r.entityId === F)).toBe(false);

      const link = await prisma.entityLink.findUnique({ where: { id: s.entityLinkId } });
      expect(link?.fromEntityId).toBe(C);

      const ownerCard = await prisma.card.findUnique({ where: { id: s.ownerCardId } });
      expect(ownerCard?.entityId).toBe(C);
      expect(ownerCard?.entityTenantId).toBe(s.tenantId);

      const relatedCard = await prisma.card.findUnique({ where: { id: s.relatedCardId } });
      expect(relatedCard?.relatedEntityIds).toContain(C);
      expect(relatedCard?.relatedEntityIds).not.toContain(F);

      const person = await prisma.person.findUnique({ where: { id: s.personId } });
      expect(person?.entityId).toBe(C);
      expect(person?.entityTenantId).toBe(s.tenantId);
    };

    await assertHealed();

    const second = await ctx.svc!.reconcileEntityRefs(s.tenantId);
    expect(second.scanned).toBeGreaterThanOrEqual(1);
    await assertHealed();
  });
});

describe('backfillEntityTenantCompanions (integration)', () => {
  afterAll(async () => {
    if (ctx.dbReady) await cleanupMergePair();
  });

  it('заполняет NULL-компаньоны и идемпотентен', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = await getPrismaClient();
    const s = await seedMergePair('bfcomp');

    await prisma.$executeRawUnsafe(
      `UPDATE persons SET "entityTenantId" = NULL WHERE id = $1`,
      s.personId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "Entity" SET "mergedIntoId" = $1, "mergedIntoTenantId" = NULL WHERE id = $2 AND "tenantId" = $3`,
      s.bId,
      s.aId,
      s.tenantId,
    );

    const first = await backfillEntityTenantCompanions(prisma, true);
    expect(first.persons).toBeGreaterThanOrEqual(1);
    expect(first.entities).toBeGreaterThanOrEqual(1);

    const person = await prisma.person.findUnique({ where: { id: s.personId } });
    expect(person?.entityTenantId).toBe(s.tenantId);

    const a = await prisma.entity.findUnique({
      where: { id_tenantId: { id: s.aId, tenantId: s.tenantId } },
    });
    expect(a?.mergedIntoTenantId).toBe(s.tenantId);

    const second = await backfillEntityTenantCompanions(prisma, true);
    expect(second.persons).toBe(0);
    expect(second.entities).toBe(0);
  });
});

describe('EntityMergeService.mergeManually (unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('делегирует в mergeEntities с actor.byUserId', async () => {
    const svc = new EntityMergeService(
      {} as unknown as PrismaService,
      null as unknown as LlmRouterService,
      undefined,
    );
    const spy = vi
      .spyOn(svc, 'mergeEntities')
      .mockResolvedValue({ ok: true });

    const res = await svc.mergeManually({
      tenantId: 't1',
      fromEntityId: 'from-1',
      intoEntityId: 'into-1',
      byUserId: 'user-9',
    });

    expect(res).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      tenantId: 't1',
      fromEntityId: 'from-1',
      intoEntityId: 'into-1',
      actor: { byUserId: 'user-9' },
    });
  });
});

interface FakeEntity {
  id: string;
  tenantId: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  mergedIntoId: string | null;
  mergedIntoTenantId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeSubrecord {
  id: string;
  tenantId: string;
  entityId: string;
  entityTenantId?: string | null;
}

const TYPED_MODELS = [
  'vendor',
  'customer',
  'event',
  'goal',
  'document',
  'market',
  'orgUnit',
  'role',
  'department',
] as const;
type TypedModel = (typeof TYPED_MODELS)[number];

function buildFakePrisma(seed: {
  entities: FakeEntity[];
  subrecords?: Partial<Record<TypedModel, FakeSubrecord[]>>;
}): { prisma: PrismaService; store: { entities: FakeEntity[]; subrecords: Record<TypedModel, FakeSubrecord[]> } } {
  const entities = seed.entities.map((e) => ({ ...e }));
  const subrecords = Object.fromEntries(
    TYPED_MODELS.map((m) => [m, (seed.subrecords?.[m] ?? []).map((s) => ({ ...s }))]),
  ) as Record<TypedModel, FakeSubrecord[]>;

  const entityDelegate = {
    findUnique: async ({ where }: { where: { id_tenantId: { id: string; tenantId: string } } }) =>
      entities.find(
        (e) => e.id === where.id_tenantId.id && e.tenantId === where.id_tenantId.tenantId,
      ) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id_tenantId: { id: string; tenantId: string } };
      data: Record<string, unknown>;
    }) => {
      const e = entities.find(
        (x) => x.id === where.id_tenantId.id && x.tenantId === where.id_tenantId.tenantId,
      );
      if (!e) throw new Error('fake entity.update: not found');
      Object.assign(e, data);
      return e;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { tenantId: string; mergedIntoId: string };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const e of entities) {
        if (e.tenantId === where.tenantId && e.mergedIntoId === where.mergedIntoId) {
          Object.assign(e, data);
          count++;
        }
      }
      return { count };
    },
    count: async () => 0,
  };

  const emptyGraphDelegate = {
    findMany: async () => [],
    findUnique: async () => null,
    findFirst: async () => null,
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
    delete: async () => ({}),
    count: async () => 0,
  };

  const makeTypedDelegate = (model: TypedModel) => ({
    findUnique: async ({ where }: { where: { entityId: string }; select?: unknown }) =>
      subrecords[model].find((s) => s.entityId === where.entityId) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { entityId: string };
      data: { entityId: string; entityTenantId?: string };
    }) => {
      const s = subrecords[model].find((x) => x.entityId === where.entityId);
      if (!s) throw new Error(`fake ${model}.update: not found`);
      s.entityId = data.entityId;
      if (data.entityTenantId !== undefined) s.entityTenantId = data.entityTenantId;
      return s;
    },
    delete: async ({ where }: { where: { entityId: string } }) => {
      const idx = subrecords[model].findIndex((x) => x.entityId === where.entityId);
      if (idx < 0) throw new Error(`fake ${model}.delete: not found`);
      return subrecords[model].splice(idx, 1)[0];
    },
    count: async ({ where }: { where: { tenantId: string; entityId: string } }) =>
      subrecords[model].filter(
        (s) => s.tenantId === where.tenantId && s.entityId === where.entityId,
      ).length,
  });

  const client: Record<string, unknown> = {
    entity: entityDelegate,
    ideaBlockEntity: emptyGraphDelegate,
    entityLink: emptyGraphDelegate,
    sourceEntity: emptyGraphDelegate,
    themeEntity: emptyGraphDelegate,
    card: emptyGraphDelegate,
    person: emptyGraphDelegate,
    customerRiskSnapshot: emptyGraphDelegate,
    themeExclusion: emptyGraphDelegate,
  };
  for (const m of TYPED_MODELS) {
    client[m] = makeTypedDelegate(m);
  }
  client.$transaction = async (
    fn: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => fn(client);

  return {
    prisma: client as unknown as PrismaService,
    store: { entities, subrecords },
  };
}

function makeEntity(over: Partial<FakeEntity> & Pick<FakeEntity, 'id' | 'type'>): FakeEntity {
  return {
    tenantId: 't1',
    canonicalName: over.id,
    aliases: [],
    mentionsCount: 1,
    mergedIntoId: null,
    mergedIntoTenantId: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('EntityMergeService.mergeEntities — кросс-типовой merge (unit, mock Prisma)', () => {
  it('vendor→customer: сабрекорд Vendor перецеплен, into.type=canonicalType, from tombstone', async () => {
    const { prisma, store } = buildFakePrisma({
      entities: [
        makeEntity({ id: 'vendorE', type: 'vendor', canonicalName: 'Логистик Плюс', mentionsCount: 2 }),
        makeEntity({ id: 'customerE', type: 'customer', canonicalName: 'Логистик Плюс', mentionsCount: 3 }),
      ],
      subrecords: {
        vendor: [{ id: 'v1', tenantId: 't1', entityId: 'vendorE' }],
      },
    });
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    await svc.mergeEntities({
      tenantId: 't1',
      fromEntityId: 'vendorE',
      intoEntityId: 'customerE',
      canonicalType: 'customer',
    });

    expect(store.subrecords.vendor).toHaveLength(1);
    expect(store.subrecords.vendor[0]!.entityId).toBe('customerE');

    const into = store.entities.find((e) => e.id === 'customerE')!;
    expect(into.type).toBe('customer');
    expect(into.mentionsCount).toBe(5);
    expect(into.aliases).toContain('Логистик Плюс');

    const from = store.entities.find((e) => e.id === 'vendorE')!;
    expect(from.mergedIntoId).toBe('customerE');
    expect(from.mergedIntoTenantId).toBe('t1');
  });

  it('НЕ бросает на разных type (type-guard снят) и применяет canonicalType к into', async () => {
    const { prisma, store } = buildFakePrisma({
      entities: [
        makeEntity({ id: 'techE', type: 'technology', canonicalName: 'Битрикс' }),
        makeEntity({ id: 'productE', type: 'product', canonicalName: 'Битрикс' }),
      ],
    });
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    await expect(
      svc.mergeEntities({
        tenantId: 't1',
        fromEntityId: 'techE',
        intoEntityId: 'productE',
        canonicalType: 'technology',
      }),
    ).resolves.toEqual({ ok: true });

    expect(store.entities.find((e) => e.id === 'productE')!.type).toBe('technology');
  });

  it('конфликт сабрекордов (обе имели Customer): мигрируемая удалена, каноническая сохранена', async () => {
    const { prisma, store } = buildFakePrisma({
      entities: [
        makeEntity({ id: 'fromC', type: 'customer' }),
        makeEntity({ id: 'intoC', type: 'customer' }),
      ],
      subrecords: {
        customer: [
          { id: 'cust-from', tenantId: 't1', entityId: 'fromC' },
          { id: 'cust-into', tenantId: 't1', entityId: 'intoC' },
        ],
      },
    });
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    await svc.mergeEntities({ tenantId: 't1', fromEntityId: 'fromC', intoEntityId: 'intoC' });

    expect(store.subrecords.customer).toHaveLength(1);
    expect(store.subrecords.customer[0]!.id).toBe('cust-into');
    expect(store.subrecords.customer[0]!.entityId).toBe('intoC');
  });

  it('SetNull-модель (Goal): переносит entityId и entityTenantId', async () => {
    const { prisma, store } = buildFakePrisma({
      entities: [
        makeEntity({ id: 'goalE', type: 'goal' }),
        makeEntity({ id: 'topicE', type: 'topic' }),
      ],
      subrecords: {
        goal: [{ id: 'g1', tenantId: 't1', entityId: 'goalE', entityTenantId: 't1' }],
      },
    });
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    await svc.mergeEntities({
      tenantId: 't1',
      fromEntityId: 'goalE',
      intoEntityId: 'topicE',
      canonicalType: 'goal',
    });

    expect(store.subrecords.goal[0]!.entityId).toBe('topicE');
    expect(store.subrecords.goal[0]!.entityTenantId).toBe('t1');
    expect(store.entities.find((e) => e.id === 'topicE')!.type).toBe('goal');
  });

  it('идемпотентность: повторный merge той же пары упирается в already-merged guard', async () => {
    const { prisma } = buildFakePrisma({
      entities: [
        makeEntity({ id: 'aE', type: 'vendor' }),
        makeEntity({ id: 'bE', type: 'customer' }),
      ],
      subrecords: { vendor: [{ id: 'v1', tenantId: 't1', entityId: 'aE' }] },
    });
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    await svc.mergeEntities({
      tenantId: 't1',
      fromEntityId: 'aE',
      intoEntityId: 'bE',
      canonicalType: 'customer',
    });

    await expect(
      svc.mergeEntities({
        tenantId: 't1',
        fromEntityId: 'aE',
        intoEntityId: 'bE',
        canonicalType: 'customer',
      }),
    ).rejects.toThrow('уже мержена');
  });
});

describe('EntityMergeService.findCrossTypeSameNameCandidates (unit, mock query)', () => {
  it('возвращает одноимённых другого типа (исключает person и себя через SQL)', async () => {
    const rawRows = [
      {
        id: 'customerE',
        tenantId: 't1',
        type: 'customer',
        canonicalName: 'Логистик Плюс',
        aliases: [],
        mergedIntoId: null,
        mentionsCount: 3,
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const prisma = {
      $queryRawUnsafe: vi.fn(async () => rawRows),
    } as unknown as PrismaService;
    const svc = new EntityMergeService(prisma, null as unknown as LlmRouterService, undefined);

    const res = await svc.findCrossTypeSameNameCandidates({
      tenantId: 't1',
      entityId: 'vendorE',
    });

    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe('customerE');
    expect(res[0]!.type).toBe('customer');
    const sql = (prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(sql).toContain("e.type <> 'person'");
    expect(sql).toContain('e.id <> $2');
    expect(sql).toContain('e.type <> (SELECT type FROM "Entity" WHERE id = $2)');
  });
});

describe('EntityMergeService.parseVerdict — canonicalType (unit)', () => {
  const svc = new EntityMergeService(
    {} as unknown as PrismaService,
    null as unknown as LlmRouterService,
    undefined,
  );
  const parse = (
    text: string,
    candidates: Array<{ id: string; type: string }>,
    allowed?: string[],
  ) =>
    (svc as unknown as {
      parseVerdict: (
        t: string,
        c: unknown[],
        a?: unknown[],
      ) => { verdict: string; canonicalType?: string } | null;
    }).parseVerdict(text, candidates, allowed);

  it('merge с валидным canonicalType прокидывает его', () => {
    const out = parse(
      JSON.stringify({ verdict: 'merge', canonicalId: 'cand-1', canonicalType: 'customer', explanation: 'ок' }),
      [{ id: 'cand-1', type: 'vendor' }],
      ['vendor', 'customer'],
    );
    expect(out).toMatchObject({ verdict: 'merge', canonicalId: 'cand-1', canonicalType: 'customer' });
  });

  it('невалидный canonicalType (не из allowed) игнорируется', () => {
    const out = parse(
      JSON.stringify({ verdict: 'merge', canonicalId: 'cand-1', canonicalType: 'project', explanation: 'ок' }),
      [{ id: 'cand-1', type: 'vendor' }],
      ['vendor', 'customer'],
    );
    expect(out).toMatchObject({ verdict: 'merge', canonicalId: 'cand-1' });
    expect(out && 'canonicalType' in out ? out.canonicalType : undefined).toBeUndefined();
  });

  it('canonicalType — мусорная строка (не EntityType) игнорируется', () => {
    const out = parse(
      JSON.stringify({ verdict: 'merge', canonicalId: 'cand-1', canonicalType: 'gibberish', explanation: 'ок' }),
      [{ id: 'cand-1', type: 'vendor' }],
      ['vendor', 'customer'],
    );
    expect(out && 'canonicalType' in out ? out.canonicalType : undefined).toBeUndefined();
  });
});
