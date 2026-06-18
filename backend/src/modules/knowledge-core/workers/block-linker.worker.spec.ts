import { describe, expect, it, vi } from 'vitest';

import { BlockLinkerWorker } from './block-linker.worker';

/**
 * Б16 [K2] — единый контракт «оживления» ребра. РАНЬШЕ re-upsert ребра в
 * block-linker НЕ сбрасывал soft-delete (`deletedAt`), в отличие от
 * fact-supersede.service (applyContradicts/applySupersedes), который в `update`
 * явно пишет `deletedAt: null, deletedBy: null`. Из-за этого состояние ребра
 * зависело от того, какой воркер сработал: fact-supersede оживлял удалённое
 * ребро, а linker — нет. Тест фиксирует, что теперь linker.upsert.update ТОЖЕ
 * сбрасывает deletedAt/deletedBy → оживление детерминировано.
 *
 * `process` — private; дёргаем через any-cast с замоканными зависимостями
 * (без BullMQ Worker и DI-графа).
 */
describe('BlockLinkerWorker.process — Б16 re-upsert сбрасывает soft-delete', () => {
  function buildWorker(): {
    worker: BlockLinkerWorker;
    upsert: ReturnType<typeof vi.fn>;
  } {
    const block = {
      id: 'b-from',
      tenantId: 't-1',
      status: 'canonical',
    };
    const candidate = { id: 'b-to', tenantId: 't-1', status: 'canonical' };

    const upsert = vi.fn(async () => ({
      id: 'link-1',
      tenantId: 't-1',
      fromBlockId: 'b-from',
      toBlockId: 'b-to',
      relationType: 'develops',
      status: 'active',
      validFrom: null,
      validUntil: null,
    }));

    const prisma = {
      ideaBlock: {
        findUnique: vi.fn(async () => block),
        count: vi.fn(async () => 100), // ≥ linkerMinBlocks
      },
      ideaBlockLink: { upsert },
    };

    const cfg = {
      knowledgeCore: {
        linkerMinBlocks: 5,
        linkKnnTopK: 10,
        linkMinConfidence: 0.5,
      },
    };

    const linker = {
      findLinkCandidates: vi.fn(async () => [{ candidate }]),
      judgeLink: vi.fn(async () => ({
        relationType: 'develops',
        confidence: 0.9,
        explanation: 'связаны',
        validFromHint: null,
        validUntilHint: null,
      })),
    };

    const gate = { checkOrThrow: vi.fn(async () => undefined) };
    const conflicts = { report: vi.fn(async () => undefined) };
    const temporalConflict = {
      onNewBlockLink: vi.fn(async () => ({ invalidated: 0 })),
    };

    const worker = new BlockLinkerWorker(
      {} as never, // redis
      prisma as never,
      cfg as never,
      linker as never,
      gate as never,
      conflicts as never,
      temporalConflict as never,
    );
    return { worker, upsert };
  }

  it('upsert.update содержит deletedAt:null и deletedBy:null (как fact-supersede)', async () => {
    const { worker, upsert } = buildWorker();

    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0] as {
      where: unknown;
      update: Record<string, unknown>;
    };
    expect(call.update).toMatchObject({
      status: 'active',
      deletedAt: null,
      deletedBy: null,
    });
  });
});
