import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AdminCacheService } from './admin-cache.service';
import { AdminUsageService } from './admin-usage.service';

function buildPrismaMock(findMany: ReturnType<typeof vi.fn>): {
  prisma: PrismaService;
} {
  const base = {
    aiUsageLog: { findMany },
    meeting: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: base as unknown as PrismaService };
}

function buildCacheMock(): AdminCacheService {
  return {} as unknown as AdminCacheService;
}

describe('AdminUsageService.getCallsLog', () => {
  it('строит prisma where с meetingId при фильтре по встрече', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const { prisma } = buildPrismaMock(findMany);
    const svc = new AdminUsageService(prisma, buildCacheMock());

    await svc.getCallsLog({ scope: 'global', meetingId: 'mtg_x', limit: 50 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ meetingId: 'mtg_x' }),
      }),
    );
  });
});
