import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
