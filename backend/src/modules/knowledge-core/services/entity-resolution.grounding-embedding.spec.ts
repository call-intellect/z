import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

function makeEmbed(vec: number[] | null | (() => never)): KnowledgeEmbeddingService {
  return {
    embedQuery: vi.fn(async () => {
      if (typeof vec === 'function') return vec();
      return vec;
    }),
  } as unknown as KnowledgeEmbeddingService;
}

describe('EntityResolutionService.resolveEntityHintsByEmbedding', () => {
  it('возвращает канон-имена со score >= minSim и отсекает score < minSim', async () => {
    const rows = [
      { canonicalName: 'Битрикс', score: 0.91 },
      { canonicalName: 'LiveKit', score: 0.4 },
      { canonicalName: 'Слабое', score: 0.2 },
    ];
    const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
    const prisma = { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService;
    const embed = makeEmbed(new Array<number>(1536).fill(0.1));

    const svc = new EntityResolutionService(prisma, embed);

    const result = await svc.resolveEntityHintsByEmbedding('t', 'что с crm', 10, 0.35);

    expect(result).toEqual(['Битрикс', 'LiveKit']);
    expect(result).not.toContain('Слабое');

    const sqlArg = queryRawUnsafe.mock.calls[0]?.[0] as string;
    expect(sqlArg).toContain('embedding <=> $1::vector(1536)');
    expect(sqlArg).toContain('"mergedIntoId" IS NULL');
    expect(sqlArg).toContain('LIMIT');
  });

  it('парсит score-строку и триммит имена', async () => {
    const rows = [
      { canonicalName: '  Логистик Плюс  ', score: '0.77' },
      { canonicalName: '   ', score: '0.99' },
    ];
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
    } as unknown as PrismaService;
    const svc = new EntityResolutionService(prisma, makeEmbed(new Array<number>(1536).fill(0.1)));

    const result = await svc.resolveEntityHintsByEmbedding('t', 'логистика', 10, 0.35);

    expect(result).toEqual(['Логистик Плюс']);
  });

  it('fail-open: embedQuery бросает → []', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn(),
    } as unknown as PrismaService;
    const embed = makeEmbed(() => {
      throw new Error('embed down');
    });
    const svc = new EntityResolutionService(prisma, embed);

    const result = await svc.resolveEntityHintsByEmbedding('t', 'q', 10, 0.35);

    expect(result).toEqual([]);
    expect((prisma as unknown as { $queryRawUnsafe: ReturnType<typeof vi.fn> }).$queryRawUnsafe)
      .not.toHaveBeenCalled();
  });

  it('fail-open: пустой вектор → []', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn(),
    } as unknown as PrismaService;
    const svc = new EntityResolutionService(prisma, makeEmbed([]));

    const result = await svc.resolveEntityHintsByEmbedding('t', 'q', 10, 0.35);

    expect(result).toEqual([]);
  });

  it('fail-open: $queryRawUnsafe бросает → [] + warn', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error('pgvector KO')),
    } as unknown as PrismaService;
    const svc = new EntityResolutionService(prisma, makeEmbed(new Array<number>(1536).fill(0.1)));
    const warnSpy = vi
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await svc.resolveEntityHintsByEmbedding('t', 'q', 10, 0.35);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('fail-open: embeddings-сервис отсутствует → []', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn(),
    } as unknown as PrismaService;
    const svc = new EntityResolutionService(prisma, undefined as never);

    const result = await svc.resolveEntityHintsByEmbedding('t', 'q', 10, 0.35);

    expect(result).toEqual([]);
  });
});
