import { describe, expect, it, vi } from 'vitest';

import {
  backfillReembedBlocksNoHeader,
  type BlockRow,
  type ReembedNoHeaderDeps,
} from './backfill-reembed-blocks-no-header';

function makeDeps(overrides: Partial<ReembedNoHeaderDeps> = {}): ReembedNoHeaderDeps {
  return {
    countPending: vi.fn(async () => 0),
    fetchPending: vi.fn(async () => [] as BlockRow[]),
    embedBlocks: vi.fn(async (rows: BlockRow[]) => rows.map(() => Array(1536).fill(0.1))),
    writeBlock: vi.fn(async () => {}),
    reindex: vi.fn(async () => {}),
    ...overrides,
  };
}

function block(id: string, overrides: Partial<BlockRow> = {}): BlockRow {
  return { id, tenantId: 't1', criticalQuestion: 'Q', trustedAnswer: 'A', ...overrides };
}

describe('backfillReembedBlocksNoHeader', () => {
  it('count=0 → already-present no-op: НЕ читает, НЕ эмбедит, НЕ реиндексит', async () => {
    const deps = makeDeps({ countPending: vi.fn(async () => 0) });
    const stats = await backfillReembedBlocksNoHeader(deps, { dryRun: false, skipReindex: false });
    expect(deps.fetchPending).not.toHaveBeenCalled();
    expect(deps.embedBlocks).not.toHaveBeenCalled();
    expect(deps.writeBlock).not.toHaveBeenCalled();
    expect(deps.reindex).not.toHaveBeenCalled();
    expect(stats).toEqual({
      scanned: 0,
      reembedded: 0,
      skippedEmpty: 0,
      errors: 0,
      reindexed: false,
    });
  });

  it('батчинг: один блок → embed+write+reindex', async () => {
    let served = false;
    const deps = makeDeps({
      countPending: vi.fn(async () => 1),
      fetchPending: vi.fn(async () => {
        if (served) return [];
        served = true;
        return [block('b1')];
      }),
    });
    const stats = await backfillReembedBlocksNoHeader(deps, { dryRun: false, skipReindex: false });
    expect(stats.scanned).toBe(1);
    expect(stats.reembedded).toBe(1);
    expect(deps.writeBlock).toHaveBeenCalledTimes(1);
    expect(deps.reindex).toHaveBeenCalledOnce();
    expect(stats.reindexed).toBe(true);
  });

  it('идемпотентность: второй прогон = no-op (версия совпала → countPending=0)', async () => {
    let firstRun = true;
    const stored = new Set<string>();
    const deps = makeDeps({
      countPending: vi.fn(async () => (stored.has('b1') ? 0 : 1)),
      fetchPending: vi.fn(async () => (firstRun ? [block('b1')] : [])),
      writeBlock: vi.fn(async (a: { id: string }) => {
        stored.add(a.id);
      }),
    });

    const first = await backfillReembedBlocksNoHeader(deps, { dryRun: false, skipReindex: true });
    expect(first.reembedded).toBe(1);
    expect(deps.writeBlock).toHaveBeenCalledTimes(1);

    firstRun = false;
    const second = await backfillReembedBlocksNoHeader(deps, { dryRun: false, skipReindex: true });
    expect(second.reembedded).toBe(0);
    expect(deps.fetchPending).toHaveBeenCalledTimes(1);
  });

  it('dry-run → считает, но не эмбедит/не пишет/не реиндексит', async () => {
    let served = false;
    const deps = makeDeps({
      countPending: vi.fn(async () => 1),
      fetchPending: vi.fn(async () => {
        if (served) return [];
        served = true;
        return [block('b1')];
      }),
    });
    const stats = await backfillReembedBlocksNoHeader(deps, { dryRun: true, skipReindex: false });
    expect(deps.embedBlocks).not.toHaveBeenCalled();
    expect(deps.writeBlock).not.toHaveBeenCalled();
    expect(deps.reindex).not.toHaveBeenCalled();
    expect(stats.reembedded).toBe(1);
    expect(stats.reindexed).toBe(false);
  });

  it('пустое тело (cq+ta пусто) → skippedEmpty, embed не зовётся на нём', async () => {
    let served = false;
    const deps = makeDeps({
      countPending: vi.fn(async () => 1),
      fetchPending: vi.fn(async () => {
        if (served) return [];
        served = true;
        return [block('b1', { criticalQuestion: '', trustedAnswer: '' })];
      }),
    });
    const stats = await backfillReembedBlocksNoHeader(deps, { dryRun: false, skipReindex: true });
    expect(stats.skippedEmpty).toBe(1);
    expect(stats.reembedded).toBe(0);
    expect(deps.embedBlocks).not.toHaveBeenCalled();
  });

  it('--org прокидывается в countPending и fetchPending', async () => {
    let served = false;
    const countPending = vi.fn(async () => 1);
    const fetchPending = vi.fn(async () => {
      if (served) return [];
      served = true;
      return [block('b1')];
    });
    const deps = makeDeps({ countPending, fetchPending });
    await backfillReembedBlocksNoHeader(deps, {
      dryRun: false,
      skipReindex: true,
      orgId: 'org-123',
    });
    expect(countPending).toHaveBeenCalledWith('org-123');
    expect(fetchPending).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-123' }),
    );
  });
});
