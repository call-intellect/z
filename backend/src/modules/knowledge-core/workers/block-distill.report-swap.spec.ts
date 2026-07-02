import type { IdeaBlock } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { BlockDistillWorker } from './block-distill.worker';

function buildBlock(overrides: Record<string, unknown> = {}): IdeaBlock {
  return {
    id: 'block-1',
    tenantId: 'tenant-1',
    signalType: 'decision',
    status: 'draft',
    evidenceCount: 1,
    confidence: '0.900',
    tags: [],
    primarySource: 'transcript',
    mergedIntoId: null,
    ...overrides,
  } as unknown as IdeaBlock;
}

interface Deps {
  router: { dispatch: ReturnType<typeof vi.fn> };
  coreQueue: { enqueueBlockLinker: ReturnType<typeof vi.fn> };
  merger: {
    knnCandidates: ReturnType<typeof vi.fn>;
    judgeMerge: ReturnType<typeof vi.fn>;
  };
  prisma: {
    ideaBlock: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  tx: {
    ideaBlock: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    ideaBlockEvidence: { updateMany: ReturnType<typeof vi.fn> };
    ideaBlockEntity: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
}

function buildWorker(opts: {
  draftBlock: IdeaBlock;
  candidates: Array<{ candidate: IdeaBlock; similarity: number }>;
  verdict?:
    | { verdict: 'merge'; canonicalId: string; explanation: string }
    | { verdict: 'distinct'; explanation: string };
  canonicalInTx?: IdeaBlock;
  mergeThreshold?: number;
}): { worker: BlockDistillWorker; deps: Deps & { cfg: { getDynamic: ReturnType<typeof vi.fn> } } } {
  const router = {
    dispatch: vi.fn(async () => ({ dispatched: [], fanOutBeforeTrim: 0 })),
  };
  const coreQueue = { enqueueBlockLinker: vi.fn(async () => undefined) };

  const tx = {
    ideaBlock: {
      findUnique: vi.fn(async () => opts.canonicalInTx ?? null),
      update: vi.fn(async () => undefined),
    },
    ideaBlockEvidence: { updateMany: vi.fn(async () => ({ count: 0 })) },
    ideaBlockEntity: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  };

  const prisma = {
    ideaBlock: {
      findFirst: vi.fn(async () => opts.draftBlock),
      findUnique: vi.fn(async () => opts.draftBlock),
      update: vi.fn(async () => undefined),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };

  const merger = {
    knnCandidates: vi.fn(async () => opts.candidates),
    judgeMerge: vi.fn(async () => opts.verdict ?? { verdict: 'distinct', explanation: '' }),
  };

  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false },
    knowledgeCore: { distillKnnTopK: 10, distillMergeThreshold: 0.85 },
    specialistsCombined: { enabled: false, delayMs: 0 },
    getDynamic: vi.fn(async () => opts.mergeThreshold ?? 0.85),
  } as unknown;

  const gate = { checkOrThrow: vi.fn(async () => undefined) };

  const worker = new BlockDistillWorker(
    {} as never,
    prisma as never,
    cfg as never,
    merger as never,
    coreQueue as never,
    gate as never,
    router as never,
    undefined,
    undefined,
  );

  return {
    worker,
    deps: {
      router,
      coreQueue,
      merger,
      prisma,
      tx,
      cfg: cfg as { getDynamic: ReturnType<typeof vi.fn> },
    },
  };
}

async function runProcess(worker: BlockDistillWorker, blockId = 'block-1') {
  await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
    data: { blockId },
  });
}

describe('BlockDistillWorker — Ф4 ГАРД B (report swapDirection)', () => {
  it('(а) РЕГРЕСС transcript↔transcript merge → mergeInto, НЕ swapDirection', async () => {
    const newBlock = buildBlock({ id: 'new-t', primarySource: 'transcript' });
    const canonical = buildBlock({
      id: 'canon-t',
      status: 'canonical',
      primarySource: 'transcript',
      evidenceCount: 2,
      confidence: '0.800',
    });
    const { worker, deps } = buildWorker({
      draftBlock: newBlock,
      candidates: [{ candidate: canonical, similarity: 0.95 }],
      verdict: { verdict: 'merge', canonicalId: 'canon-t', explanation: 'дубль' },
      canonicalInTx: canonical,
    });

    await runProcess(worker, 'new-t');

    expect(deps.tx.ideaBlock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'new-t', tenantId: 'tenant-1' } },
        data: {
          status: 'merged_into',
          mergedIntoId: 'canon-t',
          mergedIntoTenantId: 'tenant-1',
        },
      }),
    );
    expect(deps.tx.ideaBlock.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'canon-t', tenantId: 'tenant-1' } },
        data: expect.objectContaining({ mergedIntoId: 'new-t' }),
      }),
    );
    expect(deps.router.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'canon-t' }));
  });

  it('(б) РЕГРЕСС report↔report merge → штатный mergeInto', async () => {
    const newBlock = buildBlock({ id: 'new-r', primarySource: 'report' });
    const canonical = buildBlock({
      id: 'canon-r',
      status: 'canonical',
      primarySource: 'report',
      evidenceCount: 1,
      confidence: '0.500',
    });
    const { worker, deps } = buildWorker({
      draftBlock: newBlock,
      candidates: [{ candidate: canonical, similarity: 0.95 }],
      verdict: { verdict: 'merge', canonicalId: 'canon-r', explanation: 'дубль' },
      canonicalInTx: canonical,
    });

    await runProcess(worker, 'new-r');

    expect(deps.tx.ideaBlock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'new-r', tenantId: 'tenant-1' } },
        data: {
          status: 'merged_into',
          mergedIntoId: 'canon-r',
          mergedIntoTenantId: 'tenant-1',
        },
      }),
    );
    expect(deps.tx.ideaBlock.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'canon-r', tenantId: 'tenant-1' } },
        data: expect.objectContaining({ mergedIntoId: 'new-r' }),
      }),
    );
  });

  it('(в) ПОЗИТИВ new=transcript, canonical=report, merge → swapDirection (транскрипт canonical, report→merged_into, confidence=max)', async () => {
    const transcriptNew = buildBlock({
      id: 'new-t',
      primarySource: 'transcript',
      evidenceCount: 1,
      confidence: '0.900',
      tags: ['t'],
    });
    const reportCanonical = buildBlock({
      id: 'canon-r',
      status: 'canonical',
      primarySource: 'report',
      evidenceCount: 1,
      confidence: '0.600',
      tags: ['r'],
    });
    const { worker, deps } = buildWorker({
      draftBlock: transcriptNew,
      candidates: [{ candidate: reportCanonical, similarity: 0.95 }],
      verdict: { verdict: 'merge', canonicalId: 'canon-r', explanation: 'дубль' },
      canonicalInTx: reportCanonical,
    });

    await runProcess(worker, 'new-t');

    expect(deps.tx.ideaBlock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: 'canon-r', tenantId: 'tenant-1' } },
        data: {
          status: 'merged_into',
          mergedIntoId: 'new-t',
          mergedIntoTenantId: 'tenant-1',
        },
      }),
    );
    const swapUpdate = deps.tx.ideaBlock.update.mock.calls.find(
      (c) => (c[0] as { where: { id_tenantId: { id: string } } }).where.id_tenantId.id === 'new-t',
    );
    expect(swapUpdate).toBeDefined();
    const swapData = (swapUpdate![0] as { data: Record<string, unknown> }).data;
    expect(swapData.status).toBe('canonical');
    expect(swapData.mergedIntoId).toBeNull();
    expect(swapData.mergedIntoTenantId).toBeNull();
    expect(String(swapData.confidence)).toBe('0.9');
    expect(swapData.evidenceCount).toBe(2);
    expect(deps.tx.ideaBlockEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId: 'canon-r' },
        data: { blockId: 'new-t' },
      }),
    );
    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('new-t');
    expect(deps.router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-t', signalType: 'decision' }),
    );
  });

  it('(г) ПОЗИТИВ report-only без KNN → markCanonical, блок primarySource=report сохранён', async () => {
    const reportOnly = buildBlock({
      id: 'new-r',
      primarySource: 'report',
      confidence: '0.600',
    });
    const { worker, deps } = buildWorker({
      draftBlock: reportOnly,
      candidates: [],
    });

    await runProcess(worker, 'new-r');

    expect(deps.prisma.ideaBlock.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: 'new-r', tenantId: 'tenant-1' } },
      data: { status: 'canonical' },
    });
    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('new-r');
    expect(deps.router.dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-r' }));
    expect(deps.merger.judgeMerge).not.toHaveBeenCalled();
  });

  it('(в-extra) swapDirection: confidence = max когда report выше транскрипта', async () => {
    const transcriptNew = buildBlock({
      id: 'new-t',
      primarySource: 'transcript',
      confidence: '0.400',
    });
    const reportCanonical = buildBlock({
      id: 'canon-r',
      status: 'canonical',
      primarySource: 'report',
      confidence: '0.600',
    });
    const { worker, deps } = buildWorker({
      draftBlock: transcriptNew,
      candidates: [{ candidate: reportCanonical, similarity: 0.95 }],
      verdict: { verdict: 'merge', canonicalId: 'canon-r', explanation: 'д' },
      canonicalInTx: reportCanonical,
    });

    await runProcess(worker, 'new-t');

    const swapUpdate = deps.tx.ideaBlock.update.mock.calls.find(
      (c) => (c[0] as { where: { id_tenantId: { id: string } } }).where.id_tenantId.id === 'new-t',
    );
    const swapData = (swapUpdate![0] as { data: Record<string, unknown> }).data;
    expect(String(swapData.confidence)).toBe('0.6');
  });
});

describe('BlockDistillWorker — динамический порог склейки (knowledge.distillMergeThreshold)', () => {
  it('читает порог через cfg.getDynamic и передаёт его в knnCandidates', async () => {
    const block = buildBlock({ id: 'new-1', primarySource: 'transcript' });
    const { worker, deps } = buildWorker({
      draftBlock: block,
      candidates: [],
      mergeThreshold: 0.85,
    });

    await runProcess(worker, 'new-1');

    expect(deps.cfg.getDynamic).toHaveBeenCalledWith(
      'knowledge.distillMergeThreshold',
      'DISTILL_MERGE_THRESHOLD',
      0.85,
    );
    expect(deps.merger.knnCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 0.85 }),
    );
  });

  it('применяет admin-override порога из getDynamic', async () => {
    const block = buildBlock({ id: 'new-2', primarySource: 'transcript' });
    const { worker, deps } = buildWorker({
      draftBlock: block,
      candidates: [],
      mergeThreshold: 0.7,
    });

    await runProcess(worker, 'new-2');

    expect(deps.merger.knnCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: 0.7 }),
    );
  });
});
