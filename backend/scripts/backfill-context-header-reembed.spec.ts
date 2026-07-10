import { describe, expect, it, vi } from 'vitest';

import {
  backfillContextHeaderReembed,
  buildEmbedText,
  type OldBlockRow,
  type ReembedDeps,
} from './backfill-context-header-reembed';

function makeDeps(overrides: Partial<ReembedDeps> = {}): ReembedDeps {
  return {
    countOld: vi.fn(async () => 0),
    fetchOld: vi.fn(async () => [] as OldBlockRow[]),
    loadHeaderInput: vi.fn(async () => ({
      sourceTitle: 'X',
      companies: ['C'],
      participants: ['P'],
      meetingType: null,
      meetingDateIso: null,
    })),
    headerEnabled: vi.fn(async () => true),
    embed: vi.fn(async (texts: string[]) => texts.map(() => Array(768).fill(0.1))),
    writeBlock: vi.fn(async () => {}),
    reindex: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('buildEmbedText', () => {
  it('склеивает header + тело блока через перевод строки', () => {
    const block: OldBlockRow = {
      id: 'b1',
      tenantId: 't1',
      criticalQuestion: 'Q?',
      trustedAnswer: 'A.',
    };
    expect(buildEmbedText('Контекст: источник «X»', block)).toBe('Контекст: источник «X»\nQ? A.');
  });

  it('пустой header → только тело блока', () => {
    const block: OldBlockRow = {
      id: 'b1',
      tenantId: 't1',
      criticalQuestion: 'Q?',
      trustedAnswer: 'A.',
    };
    expect(buildEmbedText('', block)).toBe('Q? A.');
  });
});

describe('backfillContextHeaderReembed', () => {
  it('count=0 → already-present no-op: НЕ читает блоки, НЕ эмбедит, НЕ реиндексит', async () => {
    const deps = makeDeps({ countOld: vi.fn(async () => 0) });
    const stats = await backfillContextHeaderReembed(deps, { dryRun: false, skipReindex: false });
    expect(deps.fetchOld).not.toHaveBeenCalled();
    expect(deps.embed).not.toHaveBeenCalled();
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

  it('второй прогон = no-op (версия совпала → countOld=0)', async () => {
    let firstRun = true;
    const stored = new Set<string>();
    const block: OldBlockRow = { id: 'b1', tenantId: 't1', criticalQuestion: 'Q', trustedAnswer: 'A' };
    const deps = makeDeps({
      countOld: vi.fn(async () => (stored.has('b1') ? 0 : 1)),
      fetchOld: vi.fn(async () => (firstRun ? [block] : [])),
      writeBlock: vi.fn(async (a: { id: string }) => {
        stored.add(a.id);
      }),
    });

    const first = await backfillContextHeaderReembed(deps, { dryRun: false, skipReindex: true });
    expect(first.reembedded).toBe(1);
    expect(deps.writeBlock).toHaveBeenCalledTimes(1);

    firstRun = false;
    const second = await backfillContextHeaderReembed(deps, { dryRun: false, skipReindex: true });
    expect(second.reembedded).toBe(0);
    expect(deps.fetchOld).toHaveBeenCalledTimes(1);
  });

  it('реиндекс выполняется после успешного ре-эмбеддинга (skipReindex=false)', async () => {
    let served = false;
    const block: OldBlockRow = { id: 'b1', tenantId: 't1', criticalQuestion: 'Q', trustedAnswer: 'A' };
    const deps = makeDeps({
      countOld: vi.fn(async () => 1),
      fetchOld: vi.fn(async () => {
        if (served) return [];
        served = true;
        return [block];
      }),
    });
    const stats = await backfillContextHeaderReembed(deps, { dryRun: false, skipReindex: false });
    expect(stats.reembedded).toBe(1);
    expect(deps.reindex).toHaveBeenCalledOnce();
    expect(stats.reindexed).toBe(true);
  });

  it('dry-run → не пишет и не реиндексит', async () => {
    let served = false;
    const block: OldBlockRow = { id: 'b1', tenantId: 't1', criticalQuestion: 'Q', trustedAnswer: 'A' };
    const deps = makeDeps({
      countOld: vi.fn(async () => 1),
      fetchOld: vi.fn(async () => {
        if (served) return [];
        served = true;
        return [block];
      }),
    });
    const stats = await backfillContextHeaderReembed(deps, { dryRun: true, skipReindex: false });
    expect(deps.embed).not.toHaveBeenCalled();
    expect(deps.writeBlock).not.toHaveBeenCalled();
    expect(deps.reindex).not.toHaveBeenCalled();
    expect(stats.reembedded).toBe(1);
    expect(stats.reindexed).toBe(false);
  });
});
