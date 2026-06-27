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
describe('BlockLinkerWorker.process — Б16 re-upsert + Ф6 риск-тиринг', () => {
  function buildWorker(
    opts: {
      relationType?: string;
      confidence?: number;
      confirmResult?: boolean;
    } = {},
  ): {
    worker: BlockLinkerWorker;
    upsert: ReturnType<typeof vi.fn>;
    confirmRiskLink: ReturnType<typeof vi.fn>;
    incRiskEdge: ReturnType<typeof vi.fn>;
  } {
    const block = { id: 'b-from', tenantId: 't-1', status: 'canonical' };
    const candidate = { id: 'b-to', tenantId: 't-1', status: 'canonical' };
    const relationType = opts.relationType ?? 'develops';

    const upsert = vi.fn(async () => ({
      id: 'link-1',
      tenantId: 't-1',
      fromBlockId: 'b-from',
      toBlockId: 'b-to',
      relationType,
      status: 'active',
      validFrom: null,
      validUntil: null,
    }));

    const prisma = {
      ideaBlock: {
        findFirst: vi.fn(async () => block),
        count: vi.fn(async () => 100),
      },
      ideaBlockLink: { upsert },
    };

    const cfg = {
      knowledgeCore: { linkerMinBlocks: 5, linkKnnTopK: 10, linkMinConfidence: 0.5 },
      getDynamic: vi.fn(async (_key: string, _env?: unknown, def?: unknown) => def),
    };

    const confirmRiskLink = vi.fn(async () => opts.confirmResult ?? true);
    const linker = {
      findLinkCandidates: vi.fn(async () => [{ candidate }]),
      judgeLink: vi.fn(async () => ({
        relationType,
        confidence: opts.confidence ?? 0.9,
        explanation: 'связаны',
        validFromHint: null,
        validUntilHint: null,
      })),
      confirmRiskLink,
    };

    const gate = { checkOrThrow: vi.fn(async () => undefined) };
    const conflicts = { report: vi.fn(async () => undefined) };
    const temporalConflict = { onNewBlockLink: vi.fn(async () => ({ invalidated: 0 })) };
    const incRiskEdge = vi.fn();

    const worker = new BlockLinkerWorker(
      {} as never,
      prisma as never,
      cfg as never,
      linker as never,
      gate as never,
      conflicts as never,
      temporalConflict as never,
      { incRiskEdge } as never,
    );
    return { worker, upsert, confirmRiskLink, incRiskEdge };
  }

  it('upsert.update содержит deletedAt:null и deletedBy:null (как fact-supersede)', async () => {
    const { worker, upsert } = buildWorker();
    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0] as { update: Record<string, unknown> };
    expect(call.update).toMatchObject({ status: 'active', deletedAt: null, deletedBy: null });
  });

  it('обычная связь (develops) не зовёт скептика, создаётся при confidence ≥ low', async () => {
    const { worker, upsert, confirmRiskLink } = buildWorker({
      relationType: 'develops',
      confidence: 0.7,
    });
    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });
    expect(confirmRiskLink).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('риск-связь (contradicts): скептик отверг → ребро НЕ создаётся (R-1)', async () => {
    const { worker, upsert, confirmRiskLink, incRiskEdge } = buildWorker({
      relationType: 'contradicts',
      confidence: 0.95,
      confirmResult: false,
    });
    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });
    expect(confirmRiskLink).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(incRiskEdge).toHaveBeenCalledWith({ relation: 'contradicts', outcome: 'rejected_skeptic' });
  });

  it('риск-связь (contradicts): скептик подтвердил → ребро создаётся', async () => {
    const { worker, upsert, confirmRiskLink, incRiskEdge } = buildWorker({
      relationType: 'contradicts',
      confidence: 0.95,
      confirmResult: true,
    });
    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });
    expect(confirmRiskLink).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(incRiskEdge).toHaveBeenCalledWith({ relation: 'contradicts', outcome: 'created' });
  });

  it('риск-связь ниже high-порога → пропуск без скептика', async () => {
    const { worker, upsert, confirmRiskLink, incRiskEdge } = buildWorker({
      relationType: 'contradicts',
      confidence: 0.7,
    });
    await (worker as any).process({ id: 'job-1', data: { blockId: 'b-from' } });
    expect(confirmRiskLink).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(incRiskEdge).toHaveBeenCalledWith({ relation: 'contradicts', outcome: 'rejected_low_conf' });
  });
});
