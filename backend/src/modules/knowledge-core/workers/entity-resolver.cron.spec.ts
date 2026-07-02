import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import {
  buildKnowledgeCoreFixture,
  cleanupByPrefix,
} from '../../../../test/integration/knowledge-core/fixtures';
import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { EntityResolutionService } from '../services/entity-resolution.service';

import { EntityResolverCronService } from './entity-resolver.cron';

const PREFIX = 'kc-entrescron-spec';

interface Ctx {
  dbReady: boolean;
  cron: EntityResolverCronService | null;
  fixture: Awaited<ReturnType<typeof buildKnowledgeCoreFixture>> | null;
}
const ctx: Ctx = { dbReady: false, cron: null, fixture: null };

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  const prisma = await getPrismaClient();
  ctx.fixture = await buildKnowledgeCoreFixture(prisma, PREFIX);

  ctx.cron = new EntityResolverCronService(
    prisma as unknown as PrismaService,
    {} as unknown as TypedConfigService,
    {} as unknown as CoreQueueService,
    {} as unknown as EntityResolutionService,
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

describe('EntityResolverCronService.findCandidatePairs — Ф4 person-исключение (integration)', () => {
  it('пары с type=person исключены; пары type=topic возвращаются', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const f = ctx.fixture!;
    const prisma = await getPrismaClient();
    const tenant = f.orgAId;

    const aTopic = `${PREFIX}-topic-a`;
    const bTopic = `${PREFIX}-topic-b`;
    const aPerson = `${PREFIX}-person-a`;
    const bPerson = `${PREFIX}-person-b`;

    const topicVec = `[${new Array<number>(1536).fill(0.2).join(',')}]`;
    const personVec = `[${new Array<number>(1536).fill(0.7).join(',')}]`;

    await prisma.entity.createMany({
      data: [
        { id: aTopic, tenantId: tenant, type: 'topic', canonicalName: `${PREFIX}-Topic A`, aliases: [], mentionsCount: 1 },
        { id: bTopic, tenantId: tenant, type: 'topic', canonicalName: `${PREFIX}-Topic B`, aliases: [], mentionsCount: 1 },
        { id: aPerson, tenantId: tenant, type: 'person', canonicalName: `${PREFIX}-Person A`, aliases: [], mentionsCount: 1 },
        { id: bPerson, tenantId: tenant, type: 'person', canonicalName: `${PREFIX}-Person B`, aliases: [], mentionsCount: 1 },
      ],
    });

    for (const id of [aTopic, bTopic]) {
      await prisma.$executeRawUnsafe(
        'UPDATE "Entity" SET embedding = $1::vector WHERE id = $2 AND "tenantId" = $3',
        topicVec,
        id,
        tenant,
      );
    }
    for (const id of [aPerson, bPerson]) {
      await prisma.$executeRawUnsafe(
        'UPDATE "Entity" SET embedding = $1::vector WHERE id = $2 AND "tenantId" = $3',
        personVec,
        id,
        tenant,
      );
    }

    const pairs = await (
      ctx.cron as unknown as {
        findCandidatePairs: (
          t: string,
          th: number,
          l: number,
        ) => Promise<Array<{ aId?: string; bId?: string }>>;
      }
    ).findCandidatePairs(tenant, 0.99, 50);

    const involvesPerson = pairs.some(
      (p) =>
        p.aId === aPerson ||
        p.bId === aPerson ||
        p.aId === bPerson ||
        p.bId === bPerson,
    );
    expect(involvesPerson).toBe(false);

    const hasTopicPair = pairs.some(
      (p) =>
        (p.aId === aTopic && p.bId === bTopic) ||
        (p.aId === bTopic && p.bId === aTopic),
    );
    expect(hasTopicPair).toBe(true);

    await prisma.entity
      .deleteMany({
        where: {
          tenantId: tenant,
          id: { in: [aTopic, bTopic, aPerson, bPerson] },
        },
      })
      .catch(() => undefined);
  });
});
