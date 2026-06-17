import type { Entity, IdeaBlock } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type {
  LlmCallParams,
  LlmRouterService,
} from '../../ai/services/llm-router.service';

import { EntityMergeService } from './entity-merge.service';

/**
 * Б12 [K5] — `judgeMerge` обязан передавать в llm.call `dataClass`, равный
 * max'у по dataClass всех упомянутых блоков обеих сущностей. Без этого арбитр
 * сущностей всегда дефолтит на 'internal', и чувствительный контекст может
 * уйти провайдеру с меньшим maxDataClass.
 */
describe('EntityMergeService.judgeMerge — dataClass = max по блокам (Б12 [K5])', () => {
  function makeRouterReturning(text: string): {
    llm: LlmRouterService;
    call: ReturnType<typeof vi.fn>;
  } {
    const call = vi.fn(async (_params: LlmCallParams) => ({
      text,
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      durationMs: 100,
    }));
    return { llm: { call } as unknown as LlmRouterService, call };
  }

  function makeEntity(id: string): Entity {
    return {
      id,
      type: 'person',
      canonicalName: `Сущность ${id}`,
      aliases: [],
      metadata: {},
      mentionsCount: 3,
      mergedIntoId: null,
    } as unknown as Entity;
  }

  function makeBlock(id: string, dataClass: string): IdeaBlock {
    return {
      id,
      name: `Блок ${id}`,
      criticalQuestion: `Вопрос ${id}?`,
      signalType: 'idea',
      dataClass,
    } as unknown as IdeaBlock;
  }

  function makeService(llm: LlmRouterService): EntityMergeService {
    return new EntityMergeService(
      {} as never, // prisma — не нужен для judgeMerge
      llm,
      undefined, // cfg
    );
  }

  it('берёт max(dataClass) по блокам обеих сущностей (sensitive > internal)', async () => {
    const { llm, call } = makeRouterReturning(
      JSON.stringify({ verdict: 'distinct', explanation: 'разные' }),
    );
    const svc = makeService(llm);

    await svc.judgeMerge({
      tenantId: 'org1',
      entity: makeEntity('A'),
      candidate: makeEntity('B'),
      // У исходной — internal, у кандидата — sensitive: max = sensitive.
      recentBlocks: [makeBlock('blk1', 'internal')],
      candidateRecentBlocks: [makeBlock('blk2', 'sensitive')],
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'entity-merge-arbiter',
        dataClass: 'sensitive',
      }),
    );
  });

  it('пустые блоки → dataClass дефолтит на internal (maxDataClass)', async () => {
    const { llm, call } = makeRouterReturning(
      JSON.stringify({ verdict: 'distinct', explanation: 'разные' }),
    );
    const svc = makeService(llm);

    await svc.judgeMerge({
      tenantId: 'org1',
      entity: makeEntity('A'),
      candidate: makeEntity('B'),
      recentBlocks: [],
      candidateRecentBlocks: [],
    });

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ dataClass: 'internal' }),
    );
  });
});
