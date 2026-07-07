import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from '../../../../test/integration/knowledge-core/db-availability';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import type { StructuredDocumentCompilerService } from './structured-document-compiler.service';
import { TaskSolutionBuildService } from './task-solution-build.service';

const PREFIX = 'ts-build-spec';
const TENANT = `${PREFIX}-tenant`;
const USER_ID = `${PREFIX}-user`;
const PERSON_ID = `${PREFIX}-person`;
const PROJECT_ID = `${PREFIX}-project`;
const ISSUE_ID = `${PREFIX}-issue`;
const SOURCE_ID = `${PREFIX}-source`;
const RAWEVENT_ID = `${PREFIX}-rawevent`;
const BLOCK_ID = `${PREFIX}-block`;

const LONG_ANSWER =
  'Мы решили задачу так: воспроизвели баг локально, нашли причину в инвалидации кэша и починили её, добавив явный сброс.';

const ctx: { dbReady: boolean } = { dbReady: false };

function makeService(prisma: PrismaService): TaskSolutionBuildService {
  const docCompiler = {
    isEnabled: () => true,
    compile: async () => ({
      contentMd: '# Решение задачи (тест)\n- собрано из блоков',
      steps: [],
      changeReason: 'тестовая сборка',
      signals: [],
      ok: true,
    }),
  } as unknown as StructuredDocumentCompilerService;

  const embedder = {
    embedQuery: async () => null,
  } as unknown as KnowledgeEmbeddingService;

  const cfg = {
    getDynamic: async (_key: string, _env: unknown, def: unknown) => def,
  } as unknown as ConstructorParameters<typeof TaskSolutionBuildService>[5];

  const refiner = {
    extract: async () => ({ ok: true, hasConcreteMethod: true, solverNames: [] as string[] }),
  } as unknown as ConstructorParameters<typeof TaskSolutionBuildService>[3];

  const entityResolver = {
    resolvePersonByHint: async () => null,
  } as unknown as ConstructorParameters<typeof TaskSolutionBuildService>[4];

  return new TaskSolutionBuildService(prisma, docCompiler, embedder, refiner, entityResolver, cfg);
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const steps: Array<Promise<unknown>> = [
    prisma.taskSolution.deleteMany({ where: { tenantId: TENANT } }),
    prisma.cardVersion.deleteMany({ where: { tenantId: TENANT } }),
    prisma.ideaBlockEvidence.deleteMany({ where: { tenantId: TENANT } }),
    prisma.ideaBlock.deleteMany({ where: { tenantId: TENANT } }),
    prisma.rawEvent.deleteMany({ where: { tenantId: TENANT } }),
    prisma.source.deleteMany({ where: { tenantId: TENANT } }),
    prisma.issueAssignee.deleteMany({ where: { issueId: ISSUE_ID } }),
    prisma.issue.deleteMany({ where: { tenantId: TENANT } }),
    prisma.project.deleteMany({ where: { tenantId: TENANT } }),
    prisma.person.deleteMany({ where: { tenantId: TENANT } }),
    prisma.org.deleteMany({ where: { id: TENANT } }),
    prisma.user.deleteMany({ where: { id: USER_ID } }),
  ];
  for (const step of steps) {
    await step.catch(() => undefined);
  }
}

async function seed(prisma: PrismaService): Promise<void> {
  await prisma.user.create({
    data: { id: USER_ID, email: `${PREFIX}@example.com`, name: 'Исполнитель' },
  });
  await prisma.org.create({
    data: { id: TENANT, name: 'ТС-стенд', slug: TENANT, ownerId: USER_ID },
  });
  await prisma.person.create({
    data: {
      id: PERSON_ID,
      tenantId: TENANT,
      userId: USER_ID,
      name: 'Исполнитель',
      email: `${PREFIX}@example.com`,
    },
  });
  await prisma.project.create({
    data: {
      id: PROJECT_ID,
      tenantId: TENANT,
      slug: `${PREFIX}-proj`,
      identifier: 'TSB',
      name: 'Проект стенда',
      ownerId: USER_ID,
    },
  });
  await prisma.issue.create({
    data: {
      id: ISSUE_ID,
      tenantId: TENANT,
      projectId: PROJECT_ID,
      identifier: 'TSB-1',
      sequenceId: 1,
      title: 'Починить инвалидацию кэша',
      descriptionStripped: 'Клиенты видят устаревшие данные после правок.',
      createdById: USER_ID,
    },
  });
  await prisma.issueAssignee.create({
    data: { id: `${PREFIX}-assignee`, issueId: ISSUE_ID, userId: USER_ID },
  });
  await prisma.source.create({
    data: { id: SOURCE_ID, tenantId: TENANT, type: 'tracker_event', name: 'Tracker' },
  });
  await prisma.rawEvent.create({
    data: {
      id: RAWEVENT_ID,
      tenantId: TENANT,
      sourceId: SOURCE_ID,
      sourceType: 'tracker_event',
      idempotencyKey: `${PREFIX}-idem`,
      occurredAt: new Date(),
      payloadChecksum: 'chk',
      payloadSizeBytes: 0,
      payload: { contextCardId: ISSUE_ID },
    },
  });
  await prisma.ideaBlock.create({
    data: {
      id: BLOCK_ID,
      tenantId: TENANT,
      name: 'Как решили задачу с кэшем',
      criticalQuestion: 'Как была решена задача?',
      trustedAnswer: LONG_ANSWER,
      tags: ['debug', 'cache'],
      signalType: 'methodology_step',
      status: 'canonical',
      dataClass: 'internal',
    },
  });
  await prisma.ideaBlockEvidence.create({
    data: {
      id: `${PREFIX}-evidence`,
      tenantId: TENANT,
      blockId: BLOCK_ID,
      rawEventId: RAWEVENT_ID,
      sourceType: 'tracker_event',
      quote: 'починил инвалидацию кэша',
    },
  });
}

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;
  const prisma = (await getPrismaClient()) as unknown as PrismaService;
  await cleanup(prisma);
  await seed(prisma);
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

describe('TaskSolutionBuildService.runForOrg (integration)', () => {
  it('собирает ровно одну карточку с владельцем и CardVersion', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const service = makeService(prisma);

    const stats = await service.runForOrg(TENANT);
    expect(stats.candidates).toBeGreaterThanOrEqual(1);
    expect(stats.created).toBe(1);

    const ts = await prisma.taskSolution.findUnique({
      where: { tenantId_sourceIssueId: { tenantId: TENANT, sourceIssueId: ISSUE_ID } },
    });
    expect(ts).not.toBeNull();
    expect(ts?.ownerPersonId).toBe(PERSON_ID);
    expect(ts?.sourceIssueId).toBe(ISSUE_ID);
    expect((ts?.solutionMd ?? '').length).toBeGreaterThan(0);
    expect(ts?.sourceBlockIds).toContain(BLOCK_ID);

    const versions = await prisma.cardVersion.findMany({
      where: { tenantId: TENANT, resourceType: 'task_solution', resourceId: ts!.id },
    });
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it('идемпотентен: повторный прогон без новых блоков даёт Δ=0', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    const service = makeService(prisma);

    const stats = await service.runForOrg(TENANT);
    expect(stats.created).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.skippedNoNew).toBe(1);

    const count = await prisma.taskSolution.count({ where: { tenantId: TENANT } });
    expect(count).toBe(1);
  });
});

const REPEAT_IDS = ['a', 'b', 'c'].map((s) => `${PREFIX}-rep-${s}`);
const REPEAT_ISSUE_IDS = ['a', 'b', 'c'].map((s) => `${PREFIX}-repissue-${s}`);
const REPEAT_VEC = `[${Array(1536).fill(0.1).join(',')}]`;

async function seedRepeatGroup(prisma: PrismaService): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await prisma.issue.create({
      data: {
        id: REPEAT_ISSUE_IDS[i]!,
        tenantId: TENANT,
        projectId: PROJECT_ID,
        identifier: `TSB-REP${i + 1}`,
        sequenceId: 10 + i,
        title: `Похожая задача ${i + 1}`,
        descriptionStripped: 'Одинаковый способ решения.',
        createdById: USER_ID,
      },
    });
    await prisma.taskSolution.create({
      data: {
        id: REPEAT_IDS[i]!,
        tenantId: TENANT,
        title: `Решение ${i + 1}`,
        taskDescription: 'Одинаковый способ решения.',
        solutionMd: '- один и тот же способ',
        ownerPersonId: PERSON_ID,
        personSubjectIds: [PERSON_ID],
        sourceIssueId: REPEAT_ISSUE_IDS[i]!,
        dataClass: 'internal',
        version: 1,
      },
    });
    await prisma.$executeRawUnsafe(
      'UPDATE "task_solutions" SET "embedding" = $1::vector WHERE "id" = $2',
      REPEAT_VEC,
      REPEAT_IDS[i]!,
    );
  }
}

describe('TaskSolutionBuildService.assignRepeatGroup (integration)', () => {
  it('3 близких решения → общий repeatGroupKey и candidateInstruction=true', async (testCtx) => {
    if (skipIfNoDb(testCtx)) return;
    const prisma = (await getPrismaClient()) as unknown as PrismaService;
    await seedRepeatGroup(prisma);
    const service = makeService(prisma);

    await (
      service as unknown as {
        assignRepeatGroup: (t: string, id: string, vec: string) => Promise<void>;
      }
    ).assignRepeatGroup(TENANT, REPEAT_IDS[2]!, REPEAT_VEC);

    const solutions = await prisma.taskSolution.findMany({
      where: { id: { in: REPEAT_IDS } },
      select: { id: true, repeatGroupKey: true, candidateInstruction: true },
      orderBy: { id: 'asc' },
    });
    expect(solutions).toHaveLength(3);
    const keys = new Set(solutions.map((s) => s.repeatGroupKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBeTruthy();
    expect(solutions.every((s) => s.candidateInstruction)).toBe(true);
  });
});
