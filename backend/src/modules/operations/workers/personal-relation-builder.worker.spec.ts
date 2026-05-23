import { describe, expect, it, vi } from 'vitest';

import { PersonalRelationBuilderWorker } from './personal-relation-builder.worker';

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
