import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import type { KnowledgeEmbeddingService } from './embedding.service';

function makeService(opts: {
  themeRows?: Array<{ id: string; summary: string | null }>;
  qvec?: number[] | null;
  themeBlockRows?: Record<string, Array<{ blockId: string }>>;
}): {
  svc: ChatV2RetrievalService;
  calls: Array<{ sql: string; params: unknown[] }>;
  themeIdeaBlockFindMany: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const themeIdeaBlockFindMany = vi.fn(async (arg: { where: { themeId: string } }) => {
    const themeId = arg.where.themeId;
    return opts.themeBlockRows?.[themeId] ?? [];
  });
  const prisma = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return opts.themeRows ?? [];
    }),
    themeIdeaBlock: { findMany: themeIdeaBlockFindMany },
  } as unknown as PrismaService;

  const cfg = {
    ai: { embeddings: { dimensions: 3 } },
  } as unknown as TypedConfigService;

  const embedQuery = vi.fn(async () =>
    opts.qvec === undefined ? [0.1, 0.2, 0.3] : opts.qvec,
  );
  const embed = { embedQuery } as unknown as KnowledgeEmbeddingService;

  const svc = new ChatV2RetrievalService(prisma, cfg, embed);
  return { svc, calls, themeIdeaBlockFindMany, embedQuery };
}

describe('ChatV2RetrievalService.selectTopThemes (Ф6 R4)', () => {
  it('возвращает темы в порядке близости (top-N по cosine к Theme.embedding)', async () => {
    const { svc, calls } = makeService({
      themeRows: [
        { id: 'th-near', summary: 'самая близкая' },
        { id: 'th-mid', summary: 'средняя' },
      ],
    });
    const out = await svc.selectTopThemes({
      tenantId: 't1',
      query: 'что у нас по продажам',
      limit: 5,
    });
    expect(out).toEqual([
      { id: 'th-near', summary: 'самая близкая' },
      { id: 'th-mid', summary: 'средняя' },
    ]);
    const { sql } = calls[0]!;
    expect(sql).toContain('ORDER BY embedding <=>');
    expect(sql).toContain('LIMIT');
  });

  it('tenantId в WHERE (изоляция) + status active + embedding IS NOT NULL', async () => {
    const { svc, calls } = makeService({
      themeRows: [{ id: 'th-1', summary: 's' }],
    });
    await svc.selectTopThemes({ tenantId: 't-iso', query: 'обзор', limit: 5 });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('"tenantId" = $1');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('embedding IS NOT NULL');
    expect(params[0]).toBe('t-iso');
  });

  it('branch сужает (добавляет фильтр branch=ANY), но порядок остаётся по близости', async () => {
    const { svc, calls } = makeService({
      themeRows: [{ id: 'th-sales', summary: 's' }],
    });
    await svc.selectTopThemes({
      tenantId: 't1',
      query: 'продажи',
      limit: 5,
      branches: ['sales', 'marketing'],
    });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('"branch" = ANY(');
    expect(sql).toContain('::text[]');
    // порядок — по cosine, branch только в WHERE (до ORDER BY).
    const wherePos = sql.indexOf('"branch" = ANY(');
    const orderPos = sql.indexOf('ORDER BY embedding <=>');
    expect(wherePos).toBeGreaterThan(0);
    expect(orderPos).toBeGreaterThan(wherePos);
    expect(params).toContainEqual(['sales', 'marketing']);
  });

  it('пустой qvec (embedQuery → null) → [] без SQL', async () => {
    const { svc, calls } = makeService({ qvec: null });
    const out = await svc.selectTopThemes({ tenantId: 't1', query: 'x', limit: 5 });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('limit<=0 → [] без SQL и без эмбеддинга', async () => {
    const { svc, calls, embedQuery } = makeService({});
    const out = await svc.selectTopThemes({ tenantId: 't1', query: 'x', limit: 0 });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('вектор неверной размерности → guard зануляет → [] без SQL', async () => {
    const { svc, calls } = makeService({ qvec: [0.1, 0.2] });
    const out = await svc.selectTopThemes({ tenantId: 't1', query: 'x', limit: 5 });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('ChatV2RetrievalService.poolByThemes (Ф6 R4)', () => {
  it('собирает blockId по всем темам, дедуп, обрезает по limit', async () => {
    const { svc } = makeService({
      themeBlockRows: {
        'th-1': [{ blockId: 'b1' }, { blockId: 'b2' }],
        'th-2': [{ blockId: 'b2' }, { blockId: 'b3' }],
      },
    });
    const out = await svc.poolByThemes('t1', ['th-1', 'th-2'], 10);
    expect(out).toEqual(['b1', 'b2', 'b3']);
  });

  it('пустые themeIds → []', async () => {
    const { svc, themeIdeaBlockFindMany } = makeService({});
    const out = await svc.poolByThemes('t1', [], 10);
    expect(out).toEqual([]);
    expect(themeIdeaBlockFindMany).not.toHaveBeenCalled();
  });

  it('limit обрезает результат', async () => {
    const { svc } = makeService({
      themeBlockRows: {
        'th-1': [{ blockId: 'b1' }, { blockId: 'b2' }, { blockId: 'b3' }],
      },
    });
    const out = await svc.poolByThemes('t1', ['th-1'], 2);
    expect(out).toEqual(['b1', 'b2']);
  });
});
