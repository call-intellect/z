import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  ThemeFillService,
  selectAutofillCandidates,
  type AutofillCandidate,
} from './theme-fill.service';

function unitVector(dim: number, hot: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[hot] = 1;
  return v;
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

describe('selectAutofillCandidates', () => {
  const opts = { threshold: 0.7, maxPerScan: 10, dedupeSimilarity: 0.95 };

  it('пропускает score >= threshold, отбрасывает score < threshold', () => {
    const cands: AutofillCandidate[] = [
      { blockId: 'high', score: 0.8, embedding: unitVector(4, 0) },
      { blockId: 'low', score: 0.5, embedding: unitVector(4, 1) },
    ];
    const out = selectAutofillCandidates(cands, opts);
    expect(out.map((c) => c.blockId)).toEqual(['high']);
  });

  it('near-дубликат (cosineSim >= dedupeSimilarity) пропускается', () => {
    const shared = unitVector(4, 0);
    const cands: AutofillCandidate[] = [
      { blockId: 'a', score: 0.9, embedding: shared },
      { blockId: 'dup', score: 0.85, embedding: [...shared] },
      { blockId: 'b', score: 0.8, embedding: unitVector(4, 1) },
    ];
    const out = selectAutofillCandidates(cands, opts);
    expect(out.map((c) => c.blockId)).toEqual(['a', 'b']);
  });

  it('не возвращает больше maxPerScan', () => {
    const cands: AutofillCandidate[] = [
      { blockId: 'a', score: 0.9, embedding: unitVector(4, 0) },
      { blockId: 'b', score: 0.85, embedding: unitVector(4, 1) },
      { blockId: 'c', score: 0.8, embedding: unitVector(4, 2) },
    ];
    const out = selectAutofillCandidates(cands, { ...opts, maxPerScan: 2 });
    expect(out.map((c) => c.blockId)).toEqual(['a', 'b']);
  });
});

describe('ThemeFillService.fillTheme', () => {
  let prisma: {
    theme: { findFirst: ReturnType<typeof vi.fn> };
    themeIdeaBlock: { createMany: ReturnType<typeof vi.fn> };
    themeEntity: { findMany: ReturnType<typeof vi.fn> };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let svc: ThemeFillService;

  const baseOpts = {
    threshold: 0.7,
    scanWindowDays: 30,
    maxPerScan: 10,
    dedupeSimilarity: 0.95,
  };

  beforeEach(() => {
    prisma = {
      theme: { findFirst: vi.fn() },
      themeIdeaBlock: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      themeEntity: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn(),
    };
    svc = new ThemeFillService(prisma as unknown as PrismaService);
  });

  it('тема без embedding → {added:0}', async () => {
    prisma.theme.findFirst.mockResolvedValue({ id: 'theme-1' });
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ embedding: null }]);

    const res = await svc.fillTheme({
      tenantId: 't1',
      themeId: 'theme-1',
      opts: baseOpts,
    });

    expect(res).toEqual({ added: 0, addedBlockIds: [] });
    expect(prisma.themeIdeaBlock.createMany).not.toHaveBeenCalled();
  });

  it('несуществующая тема → {added:0}', async () => {
    prisma.theme.findFirst.mockResolvedValue(null);

    const res = await svc.fillTheme({
      tenantId: 't1',
      themeId: 'missing',
      opts: baseOpts,
    });

    expect(res).toEqual({ added: 0, addedBlockIds: [] });
  });

  it('кандидаты из $queryRawUnsafe вставляются как addedVia:autofill со score', async () => {
    prisma.theme.findFirst.mockResolvedValue({ id: 'theme-1' });
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ embedding: vectorLiteral(unitVector(4, 0)) }])
      .mockResolvedValueOnce([
        {
          blockId: 'blk-1',
          score: 0.86,
          embedding: vectorLiteral(unitVector(4, 0)),
        },
        {
          blockId: 'blk-2',
          score: 0.78,
          embedding: vectorLiteral(unitVector(4, 1)),
        },
      ]);

    const res = await svc.fillTheme({
      tenantId: 't1',
      themeId: 'theme-1',
      opts: baseOpts,
    });

    expect(res.added).toBe(2);
    expect(res.addedBlockIds).toEqual(['blk-1', 'blk-2']);
    expect(prisma.themeIdeaBlock.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            blockId: 'blk-1',
            addedVia: 'autofill',
            themeId: 'theme-1',
            tenantId: 't1',
          }),
        ]),
      }),
    );
    const call = prisma.themeIdeaBlock.createMany.mock.calls[0]![0] as {
      data: Array<{ blockId: string; score: { toString(): string } }>;
    };
    const first = call.data.find((d) => d.blockId === 'blk-1')!;
    expect(first.score.toString()).toBe('0.86');
  });
});
