import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ChatV2RetrievalService } from './chat-v2-retrieval.service';
import type { KnowledgeEmbeddingService } from './embedding.service';

function makeService(rows: Array<{ blockId: string; occurredAt: Date | null }>): {
  svc: ChatV2RetrievalService;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const prisma = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return rows;
    }),
  } as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const embed = {} as unknown as KnowledgeEmbeddingService;
  const svc = new ChatV2RetrievalService(prisma, cfg, embed);
  return { svc, calls };
}

describe('ChatV2RetrievalService.runStructuralAggregate (Ф4 R1)', () => {
  it('пустые personIds и entityIds → [] (без SQL — семантическая страховка)', async () => {
    const { svc, calls } = makeService([]);
    const out = await svc.runStructuralAggregate({
      tenantId: 't1',
      personIds: [],
      entityIds: [],
      limit: 30,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('полнота обхода: 3 источника Person P → 3 блока, по свежести occurredAt DESC', async () => {
    const { svc } = makeService([
      { blockId: 'b3', occurredAt: new Date('2026-06-20') },
      { blockId: 'b2', occurredAt: new Date('2026-06-10') },
      { blockId: 'b1', occurredAt: new Date('2026-06-01') },
    ]);
    const out = await svc.runStructuralAggregate({
      tenantId: 't1',
      personIds: ['P'],
      entityIds: [],
      limit: 30,
    });
    expect(out).toEqual(['b3', 'b2', 'b1']);
  });

  it('tenantId в КАЖДОМ WHERE/JOIN (изоляция + partition-pruning)', async () => {
    const { svc, calls } = makeService([{ blockId: 'b1', occurredAt: null }]);
    await svc.runStructuralAggregate({
      tenantId: 't-iso',
      personIds: ['P'],
      entityIds: ['E'],
      limit: 30,
    });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('"SourceParticipant"');
    expect(sql).toContain('"SourceEntity"');
    expect(sql).toContain('ev."tenantId" = $1');
    expect(sql).toContain('ep."tenantId" = $1');
    expect(sql).toContain('re."tenantId" = $1');
    expect(sql).toContain('b."tenantId" = $1');
    // UNION-источники (SourceParticipant/SourceEntity) тоже tenant-скоупны.
    expect(sql).toContain('"tenantId" = $1');
    expect(params[0]).toBe('t-iso');
    expect(params).toContainEqual(['P']);
    expect(params).toContainEqual(['E']);
  });

  it('только entityIds (группа/чат) → один UNION-источник по SourceEntity', async () => {
    const { svc, calls } = makeService([{ blockId: 'b1', occurredAt: null }]);
    await svc.runStructuralAggregate({
      tenantId: 't1',
      personIds: [],
      entityIds: ['group-z'],
      limit: 30,
    });
    const { sql } = calls[0]!;
    expect(sql).toContain('"SourceEntity"');
    expect(sql).not.toContain('"SourceParticipant"');
  });

  it('limit<=0 → [] без SQL', async () => {
    const { svc, calls } = makeService([]);
    const out = await svc.runStructuralAggregate({
      tenantId: 't1',
      personIds: ['P'],
      entityIds: [],
      limit: 0,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

interface EpisodeRowMock {
  id: string;
  title: string;
  occurredAt: Date;
  kind: string;
  rawEventId: string;
}

function makeEpisodeService(rows: EpisodeRowMock[]): {
  svc: ChatV2RetrievalService;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const prisma = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return rows;
    }),
  } as unknown as PrismaService;
  const cfg = {} as unknown as TypedConfigService;
  const embed = {} as unknown as KnowledgeEmbeddingService;
  const svc = new ChatV2RetrievalService(prisma, cfg, embed);
  return { svc, calls };
}

describe('ChatV2RetrievalService.listEpisodesByActors (Ф10 R12)', () => {
  it('пустые personIds и entityIds → [] без SQL', async () => {
    const { svc, calls } = makeEpisodeService([]);
    const out = await svc.listEpisodesByActors({
      tenantId: 't1',
      personIds: [],
      entityIds: [],
      limit: 30,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('эпизоды по person → возвращает {id,title,occurredAt,kind,rawEventId}', async () => {
    const rows: EpisodeRowMock[] = [
      {
        id: 'ep-2',
        title: 'Свежее',
        occurredAt: new Date('2026-06-20'),
        kind: 'meeting',
        rawEventId: 're-2',
      },
      {
        id: 'ep-1',
        title: 'Старое',
        occurredAt: new Date('2026-06-01'),
        kind: 'document',
        rawEventId: 're-1',
      },
    ];
    const { svc } = makeEpisodeService(rows);
    const out = await svc.listEpisodesByActors({
      tenantId: 't1',
      personIds: ['P'],
      entityIds: [],
      limit: 30,
    });
    expect(out).toEqual(rows);
  });

  it('tenantId в КАЖДОМ WHERE + порядок по occurredAt DESC', async () => {
    const { svc, calls } = makeEpisodeService([
      {
        id: 'ep-1',
        title: 'A',
        occurredAt: new Date('2026-06-01'),
        kind: 'meeting',
        rawEventId: 're-1',
      },
    ]);
    await svc.listEpisodesByActors({
      tenantId: 't-iso',
      personIds: ['P'],
      entityIds: ['E'],
      limit: 30,
    });
    const { sql, params } = calls[0]!;
    expect(sql).toContain('SourceParticipant');
    expect(sql).toContain('SourceEntity');
    expect(sql).toContain('"SourceEpisode"');
    expect(sql).toContain('ep."tenantId" = $1');
    expect(sql).toContain('ORDER BY ep."occurredAt" DESC');
    expect(params[0]).toBe('t-iso');
    expect(params).toContainEqual(['P']);
    expect(params).toContainEqual(['E']);
  });

  it('limit<=0 → [] без SQL', async () => {
    const { svc, calls } = makeEpisodeService([]);
    const out = await svc.listEpisodesByActors({
      tenantId: 't1',
      personIds: ['P'],
      entityIds: [],
      limit: 0,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
