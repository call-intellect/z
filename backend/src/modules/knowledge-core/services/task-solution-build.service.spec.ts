import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeEmbeddingService } from './embedding.service';
import type { StructuredDocumentCompilerService } from './structured-document-compiler.service';
import { TaskSolutionBuildService } from './task-solution-build.service';

const LONG_ANSWER =
  'Мы решили задачу так: сначала воспроизвели баг локально, затем нашли причину в кэше и починили инвалидацию.';

function makeMocks() {
  const prisma: any = {
    issue: { findFirst: vi.fn() },
    person: { findMany: vi.fn() },
    ideaBlock: { findMany: vi.fn() },
    taskSolution: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    cardVersion: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
  prisma.taskSolution.create.mockResolvedValue({ id: 'ts-new' });
  prisma.cardVersion.create.mockResolvedValue({ id: 'cv-new' });
  prisma.taskSolution.update.mockResolvedValue({ id: 'ts-new' });

  const docCompiler = {
    isEnabled: vi.fn(() => true),
    compile: vi.fn(async () => ({
      contentMd: '# Решение\nсобрано',
      steps: [],
      changeReason: 'первичная сборка из материала',
      signals: [],
      ok: true,
    })),
  } as unknown as StructuredDocumentCompilerService;

  const embedder = {
    embedQuery: vi.fn(async () => null),
  } as unknown as KnowledgeEmbeddingService;

  const cfg = {
    getDynamic: vi.fn(async (_key: string, _env: unknown, def: unknown) => def),
  } as any;

  const service = new TaskSolutionBuildService(prisma, docCompiler, embedder, cfg);
  return { service, prisma, docCompiler, embedder, cfg };
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    name: 'Как решили',
    criticalQuestion: 'Как была решена задача?',
    trustedAnswer: LONG_ANSWER,
    tags: ['debug'],
    dataClass: 'internal',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    evidence: [{ quote: 'цитата' }],
    ...overrides,
  };
}

type BuildOne = (tenantId: string, issueId: string) => Promise<string>;

function buildOne(service: TaskSolutionBuildService): BuildOne {
  return (service as unknown as { buildOne: BuildOne }).buildOne.bind(service);
}

describe('TaskSolutionBuildService.resolveOwnerPerson', () => {
  it('возвращает Person.id для assignee с найденным Person', async () => {
    const { service, prisma } = makeMocks();
    prisma.person.findMany.mockResolvedValue([{ id: 'p1', userId: 'u1' }]);
    const res = await service.resolveOwnerPerson('t1', [{ userId: 'u1' }]);
    expect(res).toBe('p1');
  });

  it('возвращает null, если у assignee нет Person', async () => {
    const { service, prisma } = makeMocks();
    prisma.person.findMany.mockResolvedValue([]);
    const res = await service.resolveOwnerPerson('t1', [{ userId: 'u1' }]);
    expect(res).toBeNull();
  });

  it('возвращает null, если assignees пуст', async () => {
    const { service, prisma } = makeMocks();
    const res = await service.resolveOwnerPerson('t1', []);
    expect(res).toBeNull();
    expect(prisma.person.findMany).not.toHaveBeenCalled();
  });
});

describe('TaskSolutionBuildService.mostSensitive', () => {
  it('выбирает самый строгий класс', () => {
    const { service } = makeMocks();
    expect(service.mostSensitive(['public', 'private', 'internal'])).toBe('private');
    expect(service.mostSensitive(['public', 'internal'])).toBe('internal');
    expect(service.mostSensitive([])).toBe('internal');
  });
});

describe('TaskSolutionBuildService.buildOne — гейт содержательности', () => {
  it('пропускает (skippedGate) при суммарном ответе короче minChars и не создаёт карточку', async () => {
    const { service, prisma } = makeMocks();
    prisma.issue.findFirst.mockResolvedValue({
      id: 'i1',
      title: 'Задача',
      description: null,
      descriptionStripped: null,
      assignees: [{ userId: 'u1' }],
    });
    prisma.person.findMany.mockResolvedValue([{ id: 'p1', userId: 'u1' }]);
    prisma.$queryRawUnsafe.mockResolvedValue([{ block_id: 'b1' }]);
    prisma.ideaBlock.findMany.mockResolvedValue([block({ trustedAnswer: 'коротко' })]);

    const res = await buildOne(service)('t1', 'i1');
    expect(res).toBe('skippedGate');
    expect(prisma.taskSolution.findUnique).not.toHaveBeenCalled();
    expect(prisma.taskSolution.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('TaskSolutionBuildService.buildOne — создание', () => {
  it('создаёт TaskSolution с владельцем и CardVersion resourceType=task_solution', async () => {
    const { service, prisma } = makeMocks();
    prisma.issue.findFirst.mockResolvedValue({
      id: 'i1',
      title: 'Починить лендинг',
      description: 'описание',
      descriptionStripped: 'описание',
      assignees: [{ userId: 'u1' }],
    });
    prisma.person.findMany.mockResolvedValue([{ id: 'p1', userId: 'u1' }]);
    prisma.$queryRawUnsafe.mockResolvedValue([{ block_id: 'b1' }]);
    prisma.ideaBlock.findMany.mockResolvedValue([block()]);
    prisma.taskSolution.findUnique.mockResolvedValue(null);

    const res = await buildOne(service)('t1', 'i1');
    expect(res).toBe('created');
    expect(prisma.taskSolution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerPersonId: 'p1',
          personSubjectIds: ['p1'],
          sourceIssueId: 'i1',
          version: 1,
        }),
      }),
    );
    expect(prisma.cardVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'task_solution',
          version: 1,
          changeReason: 'create',
          trustTier: 'auto',
        }),
      }),
    );
  });
});

describe('TaskSolutionBuildService.buildOne — идемпотентность', () => {
  it('возвращает skippedNoNew без update/CardVersion, когда новых блоков нет', async () => {
    const { service, prisma } = makeMocks();
    prisma.issue.findFirst.mockResolvedValue({
      id: 'i1',
      title: 'Починить лендинг',
      description: null,
      descriptionStripped: null,
      assignees: [{ userId: 'u1' }],
    });
    prisma.person.findMany.mockResolvedValue([{ id: 'p1', userId: 'u1' }]);
    prisma.$queryRawUnsafe.mockResolvedValue([{ block_id: 'b1' }]);
    prisma.ideaBlock.findMany.mockResolvedValue([block()]);
    prisma.taskSolution.findUnique.mockResolvedValue({
      id: 'ts-existing',
      version: 1,
      currentVersionId: 'cv-old',
      solutionMd: 'старое тело',
      skillTags: ['debug'],
      sourceBlockIds: ['b1'],
    });

    const res = await buildOne(service)('t1', 'i1');
    expect(res).toBe('skippedNoNew');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cardVersion.create).not.toHaveBeenCalled();
  });
});

type AssignRepeatGroup = (
  tenantId: string,
  solutionId: string,
  vecStr: string,
) => Promise<void>;

function assignRepeatGroup(service: TaskSolutionBuildService): AssignRepeatGroup {
  return (service as unknown as { assignRepeatGroup: AssignRepeatGroup }).assignRepeatGroup.bind(
    service,
  );
}

describe('TaskSolutionBuildService.assignRepeatGroup — кластеризация повторов', () => {
  it('не кластеризует одиночку: при groupSize < threshold updateMany не вызывается', async () => {
    const { service, prisma } = makeMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 'ts-2', repeatGroupKey: null, similarity: 0.9 }]);

    await assignRepeatGroup(service)('t1', 'ts-1', '[0.1,0.2]');

    expect(prisma.taskSolution.updateMany).not.toHaveBeenCalled();
  });

  it('игнорирует соседей ниже minSim: похожий только по расстоянию не считается повтором', async () => {
    const { service, prisma } = makeMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'ts-2', repeatGroupKey: null, similarity: 0.9 },
      { id: 'ts-3', repeatGroupKey: null, similarity: 0.5 },
      { id: 'ts-4', repeatGroupKey: null, similarity: 0.4 },
    ]);

    await assignRepeatGroup(service)('t1', 'ts-1', '[0.1,0.2]');

    expect(prisma.taskSolution.updateMany).not.toHaveBeenCalled();
  });

  it('при groupSize >= threshold и соседях без ключа: помечает группу candidateInstruction=true с ключом grp_', async () => {
    const { service, prisma } = makeMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'ts-2', repeatGroupKey: null, similarity: 0.95 },
      { id: 'ts-3', repeatGroupKey: null, similarity: 0.88 },
    ]);

    await assignRepeatGroup(service)('t1', 'ts-1', '[0.1,0.2]');

    expect(prisma.taskSolution.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.taskSolution.updateMany.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          id: { in: expect.arrayContaining(['ts-1', 'ts-2', 'ts-3']) },
          promotedToInstructionId: null,
          deletedAt: null,
        }),
        data: expect.objectContaining({
          candidateInstruction: true,
          repeatGroupKey: expect.stringMatching(/^grp_/),
        }),
      }),
    );
    expect(arg.data.repeatGroupKey).toBe('grp_ts-1');
  });

  it('наследует существующий repeatGroupKey соседа, не плодит новый', async () => {
    const { service, prisma } = makeMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'ts-2', repeatGroupKey: 'grp_X', similarity: 0.95 },
      { id: 'ts-3', repeatGroupKey: null, similarity: 0.9 },
    ]);

    await assignRepeatGroup(service)('t1', 'ts-9', '[0.1,0.2]');

    expect(prisma.taskSolution.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.taskSolution.updateMany.mock.calls[0][0];
    expect(arg.data.repeatGroupKey).toBe('grp_X');
    expect(arg.data.candidateInstruction).toBe(true);
  });
});

beforeEach(() => vi.clearAllMocks());
