import { describe, expect, it, vi } from 'vitest';

import {
  CheckInConflictDetectorCron,
  PersonalRelationBuilderWorker,
} from './personal-relation-builder.worker';

describe('PersonalRelationBuilderWorker', () => {
  function buildWorker(overrides: {
    block?: unknown;
    persons?: Array<{ id: string; tenantId: string; entityId: string | null }>;
    minConfidence?: number;
    graphConfidence?: number;
  }) {
    const persons = overrides.persons ?? [
      { id: 'author-1', tenantId: 't1', entityId: 'e1' },
    ];
    const prisma = {
      ideaBlock: { findUnique: vi.fn().mockResolvedValue(overrides.block ?? null) },
      entityLink: { upsert: vi.fn().mockResolvedValue({}) },
      person: {
        findFirst: vi.fn(async (args: { where: { id?: string; tenantId?: string } }) => {
          return (
            persons.find(
              (p) => p.id === args.where.id && p.tenantId === args.where.tenantId,
            ) ?? null
          );
        }),
      },
    };
    const metrics = {
      incPersonalRelationBuilderRun: vi.fn(),
      incCoreSpecialistSkipped: vi.fn(),
    };
    const cfg = {
      getDynamic: vi.fn(async (key: string, _env: unknown, def: number) => {
        if (key === 'knowledge.conflict_min_confidence') {
          return overrides.minConfidence ?? def;
        }
        if (key === 'knowledge.conflict_graph_confidence') {
          return overrides.graphConfidence ?? def;
        }
        return def;
      }),
    };
    const worker = new PersonalRelationBuilderWorker(
      prisma as never,
      metrics as never,
      cfg as never,
    );
    return { worker, prisma, metrics, cfg };
  }

  function runProcess(
    worker: PersonalRelationBuilderWorker,
    signalType: string,
  ): Promise<void> {
    return (
      worker as unknown as { process(job: unknown): Promise<void> }
    ).process({
      name: '3-12-personal-relation',
      data: {
        blockId: 'b1',
        tenantId: 't1',
        signalType,
        specialistName: '3-12-personal-relation',
      },
    });
  }

  it('skip если в блоке < 2 person entities', async () => {
    const { worker, metrics, prisma } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [{ entity: { id: 'e1', type: 'person', canonicalName: 'Анна' } }],
        evidence: [{ authorPersonId: 'author-1' }],
      },
    });
    await runProcess(worker, 'team_friction');
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_no_pair', source: 'graph' }),
    );
  });

  it('строит рёбра автор↔каждая сторона (не декартов клик)', async () => {
    const { worker, prisma, metrics } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', canonicalName: 'Анна' } },
          { entity: { id: 'e2', type: 'person', canonicalName: 'Борис' } },
          { entity: { id: 'e3', type: 'person', canonicalName: 'Виктор' } },
        ],
        evidence: [{ authorPersonId: 'author-1' }],
      },
      persons: [{ id: 'author-1', tenantId: 't1', entityId: 'e1' }],
    });
    await runProcess(worker, 'team_friction');
    expect(prisma.entityLink.upsert).toHaveBeenCalledTimes(2);
    const pairs = prisma.entityLink.upsert.mock.calls.map((c) => {
      const arg = c[0] as { create: { fromEntityId: string; toEntityId: string } };
      return [arg.create.fromEntityId, arg.create.toEntityId].sort().join('-');
    });
    expect(pairs.sort()).toEqual(['e1-e2', 'e1-e3']);
    const arg = prisma.entityLink.upsert.mock.calls[0]?.[0] as
      | { create: { relationType: string } }
      | undefined;
    expect(arg?.create.relationType).toBe('conflicted_with');
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'link_created', source: 'graph' }),
    );
  });

  it('skip если автор не резолвится в entity', async () => {
    const { worker, prisma, metrics } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', canonicalName: 'Анна' } },
          { entity: { id: 'e2', type: 'person', canonicalName: 'Борис' } },
        ],
        evidence: [],
      },
    });
    await runProcess(worker, 'team_friction');
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_no_pair', source: 'graph' }),
    );
  });

  it('skip для не-friction signalType', async () => {
    const { worker, prisma, metrics } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', canonicalName: 'Анна' } },
          { entity: { id: 'e2', type: 'person', canonicalName: 'Борис' } },
        ],
        evidence: [{ authorPersonId: 'author-1' }],
      },
    });
    await runProcess(worker, 'fact');
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_low_confidence', source: 'graph' }),
    );
  });

  it('читает пороги из cfg (skip при graph<min)', async () => {
    const { worker, prisma, metrics, cfg } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', canonicalName: 'Анна' } },
          { entity: { id: 'e2', type: 'person', canonicalName: 'Борис' } },
        ],
        evidence: [{ authorPersonId: 'author-1' }],
      },
      minConfidence: 0.9,
      graphConfidence: 0.65,
    });
    await runProcess(worker, 'team_friction');
    expect(cfg.getDynamic).toHaveBeenCalledWith(
      'knowledge.conflict_min_confidence',
      undefined,
      0.6,
    );
    expect(cfg.getDynamic).toHaveBeenCalledWith(
      'knowledge.conflict_graph_confidence',
      undefined,
      0.65,
    );
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_low_confidence', source: 'graph' }),
    );
  });
});

describe('CheckInConflictDetectorCron', () => {
  function buildCron(opts: {
    checkIns: Array<{
      id: string;
      tenantId: string;
      personId: string;
      rawResponseText: string | null;
      plansJson?: unknown;
      donesJson?: unknown;
      blockersJson?: unknown;
    }>;
    persons: Array<{
      id: string;
      tenantId: string;
      entityId: string | null;
      name: string;
    }>;
  }): {
    cron: CheckInConflictDetectorCron;
    prisma: {
      dailyCheckIn: { findMany: ReturnType<typeof vi.fn> };
      person: {
        findFirst: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
      };
      entityLink: { upsert: ReturnType<typeof vi.fn> };
    };
    metrics: { incPersonalRelationBuilderRun: ReturnType<typeof vi.fn> };
  } {
    const dailyCheckInFindMany = vi.fn(async () => opts.checkIns);
    const personFindFirst = vi.fn(async (args: { where: { id?: string; tenantId?: string } }) => {
      return (
        opts.persons.find((p) => p.id === args.where.id && p.tenantId === args.where.tenantId) ??
        null
      );
    });
    const personFindMany = vi.fn(async (args: { where: { tenantId?: string } }) => {
      const tenant = args.where.tenantId;
      return opts.persons.filter((p) => p.tenantId === tenant);
    });
    const entityLinkUpsert = vi.fn(async () => ({}));

    const prisma = {
      dailyCheckIn: { findMany: dailyCheckInFindMany },
      person: { findFirst: personFindFirst, findMany: personFindMany },
      entityLink: { upsert: entityLinkUpsert },
    };
    const metrics = {
      incPersonalRelationBuilderRun: vi.fn(),
      incCoreSpecialistSkipped: vi.fn(),
    };

    const cron = new CheckInConflictDetectorCron(prisma as never, metrics as never);
    return { cron, prisma, metrics };
  }

  it('создаёт EntityLink при матче «конфликт с Анной Ивановой»', async () => {
    const { cron, prisma, metrics } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: 'Сегодня был конфликт с Анной Ивановой по приоритетам',
        },
      ],
      persons: [
        { id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис Сидоров' },
        { id: 'p-anna', tenantId: 't-1', entityId: 'ent-anna', name: 'Анна Иванова' },
      ],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(1);
    expect(prisma.entityLink.upsert).toHaveBeenCalledOnce();
    const arg = prisma.entityLink.upsert.mock.calls[0]?.[0] as
      | { create: { relationType: string; properties: { source: string } } }
      | undefined;
    expect(arg?.create.relationType).toBe('conflicted_with');
    expect(arg?.create.properties.source).toBe('checkin-conflict-detector');
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'checkin_conflict_detected', source: 'regex' }),
    );
  });

  it('skip если в чек-ине нет конфликт-маркеров', async () => {
    const { cron, prisma } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: 'Всё нормально, работаем дальше',
        },
      ],
      persons: [{ id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис Сидоров' }],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(0);
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
  });

  it('skip если упомянутый Person не существует', async () => {
    const { cron, prisma } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: 'Конфликт с Гипотетический Несуществующий по поводу X',
        },
      ],
      persons: [{ id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис Сидоров' }],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(0);
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
  });

  it('skip если author.entityId === null', async () => {
    const { cron, prisma } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: 'Конфликт с Анной Ивановой',
        },
      ],
      persons: [
        { id: 'author', tenantId: 't-1', entityId: null, name: 'Борис' },
        { id: 'p-anna', tenantId: 't-1', entityId: 'ent-anna', name: 'Анна Иванова' },
      ],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(0);
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
  });

  it('skip само-упоминание (один и тот же Person)', async () => {
    const { cron, prisma } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: 'Конфликт с Анной Ивановой (это я сам с собой)',
        },
      ],
      persons: [
        {
          id: 'author',
          tenantId: 't-1',
          entityId: 'ent-a',
          name: 'Анна Иванова',
        },
      ],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(0);
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
  });

  it('собирает текст из blockersJson и plansJson', async () => {
    const { cron, prisma } = buildCron({
      checkIns: [
        {
          id: 'ci-1',
          tenantId: 't-1',
          personId: 'author',
          rawResponseText: null,
          blockersJson: [{ text: 'Спорю с Петром Васильевым по архитектуре' }],
          plansJson: [{ text: 'Доделать спецификацию' }],
        },
      ],
      persons: [
        { id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис' },
        { id: 'p-petr', tenantId: 't-1', entityId: 'ent-petr', name: 'Пётр Васильев' },
      ],
    });
    const stats = await cron.runOnce();
    expect(stats.linksCreated).toBe(1);
    expect(prisma.entityLink.upsert).toHaveBeenCalledOnce();
  });
});
