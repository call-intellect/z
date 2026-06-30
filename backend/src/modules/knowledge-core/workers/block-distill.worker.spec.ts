import type { IdeaBlock } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { BlockDistillWorker } from './block-distill.worker';

/**
 * Ф3 МТЗ «разблокировка конвейера» — unit-тесты для переноса диспатча
 * специалистов из block-ingest в block-distill на переход draft→canonical.
 *
 * Проверяем:
 *   1. markCanonical → router.dispatch вызван c { id: block.id, signalType }.
 *   2. mergeInto → router.dispatch вызван c canonicalId + signalType канонического.
 *   3. dispatch best-effort: если router.dispatch бросает — markCanonical/mergeInto
 *      не падают (статус блока уже зафиксирован, проекции просто отложены).
 *
 * markCanonical/mergeInto — private; дёргаем через any-cast, чтобы не поднимать
 * BullMQ Worker и весь DI-граф.
 */

function buildBlock(overrides: Record<string, unknown> = {}): IdeaBlock {
  return {
    id: 'block-1',
    tenantId: 'tenant-1',
    signalType: 'decision',
    status: 'draft',
    evidenceCount: 1,
    confidence: '0.900',
    dataClass: 'internal',
    tags: [],
    ...overrides,
  } as unknown as IdeaBlock;
}

interface Deps {
  router: { dispatch: ReturnType<typeof vi.fn> };
  coreQueue: { enqueueBlockLinker: ReturnType<typeof vi.fn> };
  prisma: any;
  tx: { ideaBlock: { update: ReturnType<typeof vi.fn> } };
}

function buildWorker(
  opts: {
    dispatchThrows?: boolean;
    canonicalOverrides?: Record<string, unknown>;
  } = {},
): { worker: BlockDistillWorker; deps: Deps } {
  const router = {
    dispatch: vi.fn(async () => {
      if (opts.dispatchThrows) {
        throw new Error('router boom');
      }
      return { dispatched: [], fanOutBeforeTrim: 0 };
    }),
  };
  const coreQueue = {
    enqueueBlockLinker: vi.fn(async () => undefined),
  };

  // Состояние для merge-теста.
  const merge = {
    canonical: buildBlock({
      id: 'canon-1',
      status: 'canonical',
      signalType: 'regulation',
      evidenceCount: 2,
      confidence: '0.800',
      tags: ['a'],
      ...opts.canonicalOverrides,
    }),
  };

  const tx = {
    ideaBlock: {
      findUnique: vi.fn(async () => merge.canonical),
      update: vi.fn(async () => undefined),
    },
    ideaBlockEvidence: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
  };

  const prisma = {
    ideaBlock: {
      update: vi.fn(async () => undefined),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false },
    specialistsCombined: { enabled: false, delayMs: 0 },
  } as any;

  const worker = new BlockDistillWorker(
    {} as any, // redis
    prisma as any, // prisma
    cfg, // cfg
    {} as any, // merger
    coreQueue as any, // coreQueue
    {} as any, // gate
    router as any, // router (Ф3)
    undefined, // factSupersede (Optional)
    undefined, // eventEmitter (Optional)
  );

  return { worker, deps: { router, coreQueue, prisma, tx } };
}

describe('BlockDistillWorker — Ф3 диспатч на canonical-переход', () => {
  it('markCanonical → router.dispatch вызван с id и signalType блока', async () => {
    const { worker, deps } = buildWorker();
    const block = buildBlock({ id: 'block-1', signalType: 'decision' });

    await (worker as any).markCanonical(block);

    expect(deps.prisma.ideaBlock.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: 'block-1', tenantId: 'tenant-1' } },
      data: { status: 'canonical' },
    });
    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('block-1');
    expect(deps.router.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.router.dispatch).toHaveBeenCalledWith({
      id: 'block-1',
      tenantId: 'tenant-1',
      signalType: 'decision',
    });
  });

  it('markCanonical best-effort: dispatch бросает — markCanonical не падает', async () => {
    const { worker, deps } = buildWorker({ dispatchThrows: true });
    const block = buildBlock({ id: 'block-1', signalType: 'decision' });

    await expect((worker as any).markCanonical(block)).resolves.toBeUndefined();
    expect(deps.router.dispatch).toHaveBeenCalledTimes(1);
    // статус всё равно зафиксирован, линкер поставлен.
    expect(deps.prisma.ideaBlock.update).toHaveBeenCalled();
    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('block-1');
  });

  it('mergeInto → router.dispatch вызван с canonicalId и signalType канонического', async () => {
    const { worker, deps } = buildWorker();
    const block = buildBlock({
      id: 'block-1',
      signalType: 'decision',
      evidenceCount: 1,
      confidence: '0.900',
    });

    await (worker as any).mergeInto({
      block,
      canonicalId: 'canon-1',
      explanation: 'дубликат',
    });

    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('canon-1');
    expect(deps.router.dispatch).toHaveBeenCalledTimes(1);
    // signalType берётся из канонического блока (regulation), НЕ из merged (decision).
    expect(deps.router.dispatch).toHaveBeenCalledWith({
      id: 'canon-1',
      tenantId: 'tenant-1',
      signalType: 'regulation',
    });
  });

  it('mergeInto best-effort: dispatch бросает — mergeInto не падает', async () => {
    const { worker, deps } = buildWorker({ dispatchThrows: true });
    const block = buildBlock({ id: 'block-1', signalType: 'decision' });

    await expect(
      (worker as any).mergeInto({
        block,
        canonicalId: 'canon-1',
        explanation: 'дубликат',
      }),
    ).resolves.toBeUndefined();
    expect(deps.router.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.coreQueue.enqueueBlockLinker).toHaveBeenCalledWith('canon-1');
  });
});

/**
 * Б13 [K5] — merge не должен тихо понижать dataClass canonical-носителя.
 * `tx.ideaBlock.update` в mergeInto вызывается дважды: (1) merged-блок →
 * merged_into, (2) canonical → пересчёт полей. Вытаскиваем именно
 * canonical-update (where.id==='canon-1') и проверяем dataClass.
 */
function canonicalUpdateData(
  tx: { ideaBlock: { update: ReturnType<typeof vi.fn> } },
): Record<string, unknown> | undefined {
  const call = tx.ideaBlock.update.mock.calls.find(
    (c) => (c[0] as { where: { id_tenantId: { id: string } } }).where.id_tenantId.id === 'canon-1',
  );
  return call?.[0]?.data as Record<string, unknown> | undefined;
}

describe('BlockDistillWorker — Б13 dataClass=max при merge', () => {
  it('mergeInto: более чувствительный merged-блок поднимает dataClass canonical до max', async () => {
    // canonical=internal, merged-блок=private → итог private.
    const { worker, deps } = buildWorker({
      canonicalOverrides: { dataClass: 'internal' },
    });
    const block = buildBlock({
      id: 'block-1',
      signalType: 'decision',
      dataClass: 'private',
    });

    await (worker as any).mergeInto({
      block,
      canonicalId: 'canon-1',
      explanation: 'дубликат',
    });

    const data = canonicalUpdateData(deps.tx);
    expect(data?.dataClass).toBe('private');
  });

  it('mergeInto: менее чувствительный merged-блок НЕ понижает dataClass canonical', async () => {
    // canonical=sensitive, merged-блок=internal → остаётся sensitive (max).
    const { worker, deps } = buildWorker({
      canonicalOverrides: { dataClass: 'sensitive' },
    });
    const block = buildBlock({
      id: 'block-1',
      signalType: 'decision',
      dataClass: 'internal',
    });

    await (worker as any).mergeInto({
      block,
      canonicalId: 'canon-1',
      explanation: 'дубликат',
    });

    const data = canonicalUpdateData(deps.tx);
    expect(data?.dataClass).toBe('sensitive');
  });
});
