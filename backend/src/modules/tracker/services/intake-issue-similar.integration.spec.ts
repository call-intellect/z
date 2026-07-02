import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  checkPgvectorAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { IntakeIssueSimilarService } from './intake-issue-similar.service';

const PREFIX = 'intake-similar-spec';
const TENANT = `${PREFIX}-tenant`;
const OTHER_TENANT = `${PREFIX}-tenant-other`;

const NEAR_ID = `${PREFIX}-near`;
const FAR_ID = `${PREFIX}-far`;
const ACCEPTED_ID = `${PREFIX}-accepted`;

interface Ctx {
  dbReady: boolean;
  pgvectorReady: boolean;
}

const ctx: Ctx = { dbReady: false, pgvectorReady: false };

function vecLiteral(head: number[]): string {
  const dims = new Array<number>(1536).fill(0);
  for (let i = 0; i < head.length && i < 1536; i += 1) dims[i] = head[i]!;
  return `[${dims.join(',')}]`;
}

async function seedIntakeIssue(
  prisma: PrismaService,
  args: {
    id: string;
    tenantId: string;
    status: string;
    title: string;
    embeddingHead: number[];
  },
): Promise<void> {
  await prisma.intakeIssue.create({
    data: {
      id: args.id,
      tenantId: args.tenantId,
      status: args.status,
      source: 'in_app',
      rawContent: args.title,
      extractedTitle: args.title,
    },
  });
  await prisma.$executeRawUnsafe(
    'UPDATE "IntakeIssue" SET embedding = $1::vector(1536) WHERE id = $2 AND "tenantId" = $3',
    vecLiteral(args.embeddingHead),
    args.id,
    args.tenantId,
  );
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.intakeIssue
    .deleteMany({ where: { id: { startsWith: `${PREFIX}-` } } })
    .catch(() => undefined);
}

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  ctx.pgvectorReady = await checkPgvectorAvailable();
  const prisma = (await getPrismaClient()) as unknown as PrismaService;
  await cleanup(prisma);
  await seedIntakeIssue(prisma, {
    id: NEAR_ID,
    tenantId: TENANT,
    status: 'pending',
    title: 'Починить лендинг',
    embeddingHead: [1, 0, 0],
  });
  await seedIntakeIssue(prisma, {
    id: FAR_ID,
    tenantId: TENANT,
    status: 'pending',
    title: 'Заказать кофе в офис',
    embeddingHead: [0, 1, 0],
  });
  await seedIntakeIssue(prisma, {
    id: ACCEPTED_ID,
    tenantId: TENANT,
    status: 'accepted',
    title: 'Уже принятая близкая карточка',
    embeddingHead: [1, 0, 0],
  });
});

afterAll(async () => {
  if (ctx.dbReady) {
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    await cleanup(prisma);
  }
  await closePrismaClient();
});

function skipIfNoDb(testCtx: { skip: () => void }): boolean {
  if (!ctx.dbReady) {
    testCtx.skip();
    return true;
  }
  return false;
}

describe('IntakeIssueSimilarService.findSimilarByVector (integration)', () => {
  it('возвращает близкую pending-карточку и отсекает далёкую по threshold', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const svc = new IntakeIssueSimilarService(prisma);

    const res = await svc.findSimilarByVector({
      tenantId: TENANT,
      embedding: vecLiteral([1, 0, 0]),
      threshold: 0.15,
    });

    expect(res.map((r) => r.intakeIssueId)).toContain(NEAR_ID);
    expect(res.map((r) => r.intakeIssueId)).not.toContain(FAR_ID);
    const near = res.find((r) => r.intakeIssueId === NEAR_ID)!;
    expect(near.extractedTitle).toBe('Починить лендинг');
    expect(near.distance).toBeLessThanOrEqual(0.15);
  });

  it('исключает non-pending карточку даже при близком векторе', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const svc = new IntakeIssueSimilarService(prisma);

    const res = await svc.findSimilarByVector({
      tenantId: TENANT,
      embedding: vecLiteral([1, 0, 0]),
      threshold: 0.15,
    });

    expect(res.map((r) => r.intakeIssueId)).not.toContain(ACCEPTED_ID);
  });

  it('excludeIntakeIssueId исключает саму карточку', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const svc = new IntakeIssueSimilarService(prisma);

    const res = await svc.findSimilarByVector({
      tenantId: TENANT,
      embedding: vecLiteral([1, 0, 0]),
      threshold: 0.15,
      excludeIntakeIssueId: NEAR_ID,
    });

    expect(res.map((r) => r.intakeIssueId)).not.toContain(NEAR_ID);
  });

  it('tenant-fence: чужой tenant не видит карточку', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const svc = new IntakeIssueSimilarService(prisma);

    const res = await svc.findSimilarByVector({
      tenantId: OTHER_TENANT,
      embedding: vecLiteral([1, 0, 0]),
      threshold: 0.15,
    });

    expect(res).toHaveLength(0);
  });
});
