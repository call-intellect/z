import { describe, expect, it, vi } from 'vitest';

import {
  CheckInConflictDetectorCron,
  PersonalRelationBuilderWorker,
} from './personal-relation-builder.worker';

/**
 * SBA β-8 — PersonalRelationBuilderWorker unit-тесты.
 *
 * Worker инстанс не создаём целиком (BullMQ + Redis нужны для onModuleInit),
 * проверяем приватную process()-логику через прямой вызов.
 */
describe('PersonalRelationBuilderWorker', () => {
  function buildWorker(overrides: {
    block?: unknown;
  }) {
    const prisma = {
      ideaBlock: { findUnique: vi.fn().mockResolvedValue(overrides.block ?? null) },
      entityLink: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const metrics = { incPersonalRelationBuilderRun: vi.fn() };
    const worker = new PersonalRelationBuilderWorker(
      { client: {} } as never,
      prisma as never,
      metrics as never,
    );
    return { worker, prisma, metrics };
  }

  it('skip если в блоке < 2 person entities', async () => {
    const { worker, metrics, prisma } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', name: 'Анна' } },
        ],
      },
    });
    await (worker as unknown as {
      process(job: unknown): Promise<void>;
    }).process({
      name: '3-12-personal-relation',
      data: {
        blockId: 'b1',
        tenantId: 't1',
        signalType: 'team_friction',
        specialistName: '3-12-personal-relation',
      },
    });
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_no_pair' }),
    );
  });

  it('создаёт пары conflicted_with для team_friction', async () => {
    const { worker, prisma, metrics } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', name: 'Анна' } },
          { entity: { id: 'e2', type: 'person', name: 'Борис' } },
        ],
      },
    });
    await (worker as unknown as {
      process(job: unknown): Promise<void>;
    }).process({
      name: '3-12-personal-relation',
      data: {
        blockId: 'b1',
        tenantId: 't1',
        signalType: 'team_friction',
        specialistName: '3-12-personal-relation',
      },
    });
    expect(prisma.entityLink.upsert).toHaveBeenCalledOnce();
    const arg = prisma.entityLink.upsert.mock.calls[0]?.[0] as
      | { create: { relationType: string } }
      | undefined;
    expect(arg?.create.relationType).toBe('conflicted_with');
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'link_created' }),
    );
  });

  it('skip для не-friction signalType', async () => {
    const { worker, prisma, metrics } = buildWorker({
      block: {
        id: 'b1',
        tenantId: 't1',
        status: 'canonical',
        entities: [
          { entity: { id: 'e1', type: 'person', name: 'Анна' } },
          { entity: { id: 'e2', type: 'person', name: 'Борис' } },
        ],
      },
    });
    await (worker as unknown as {
      process(job: unknown): Promise<void>;
    }).process({
      name: '3-12-personal-relation',
      data: {
        blockId: 'b1',
        tenantId: 't1',
        signalType: 'fact',
        specialistName: '3-12-personal-relation',
      },
    });
    expect(prisma.entityLink.upsert).not.toHaveBeenCalled();
    expect(metrics.incPersonalRelationBuilderRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_low_confidence' }),
    );
  });

  it('skip jobName не совпадает', async () => {
    const { worker, prisma } = buildWorker({});
    await (worker as unknown as {
      process(job: unknown): Promise<void>;
    }).process({
      name: '3-1-regulations',
      data: {
        blockId: 'b1',
        tenantId: 't1',
        signalType: 'team_friction',
        specialistName: '3-1-regulations',
      },
    });
    expect(prisma.ideaBlock.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * Pulse Wave 4 §3.2 — CheckInConflictDetectorCron.
 *
 * Daily сканирует тексты DailyCheckIn'ов и upsert'ит EntityLink(conflicted_with).
 */
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
    const personFindFirst = vi.fn(
      async (args: { where: { id?: string; tenantId?: string } }) => {
        return (
          opts.persons.find(
            (p) =>
              p.id === args.where.id && p.tenantId === args.where.tenantId,
          ) ?? null
        );
      },
    );
    const personFindMany = vi.fn(
      async (args: { where: { tenantId?: string } }) => {
        const tenant = args.where.tenantId;
        return opts.persons.filter((p) => p.tenantId === tenant);
      },
    );
    const entityLinkUpsert = vi.fn(async () => ({}));

    const prisma = {
      dailyCheckIn: { findMany: dailyCheckInFindMany },
      person: { findFirst: personFindFirst, findMany: personFindMany },
      entityLink: { upsert: entityLinkUpsert },
    };
    const metrics = { incPersonalRelationBuilderRun: vi.fn() };

    const cron = new CheckInConflictDetectorCron(
      prisma as never,
      metrics as never,
    );
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
      expect.objectContaining({ result: 'checkin_conflict_detected' }),
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
      persons: [
        { id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис Сидоров' },
      ],
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
      persons: [
        { id: 'author', tenantId: 't-1', entityId: 'ent-a', name: 'Борис Сидоров' },
      ],
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
    // Person.id=author, name=Анна Иванова — мы упоминаем самого себя.
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
