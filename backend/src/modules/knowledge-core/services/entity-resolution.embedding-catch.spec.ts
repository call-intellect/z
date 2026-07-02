import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';

describe('EntityResolutionService.resolvePersonByEmbedding', () => {
  it('logs a warning and returns [] when the pgvector query throws', async () => {
    const queryError = new Error('relation "persons" does not exist');
    const prisma = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(queryError),
    } as unknown as PrismaService;
    const embed = {
      embedQuery: vi.fn(async () => new Array<number>(1536).fill(0.1)),
    } as unknown as KnowledgeEmbeddingService;

    const svc = new EntityResolutionService(prisma, embed);
    const warnSpy = vi
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    const resolve = (
      svc as unknown as {
        resolvePersonByEmbedding: (
          tenantId: string,
          name: string,
        ) => Promise<Array<{ id: string; score: number }>>;
      }
    ).resolvePersonByEmbedding.bind(svc);

    const result = await resolve('tenant-1', 'Иван Иванов');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
