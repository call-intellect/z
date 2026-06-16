import type { PrismaService } from '../../../common/prisma/prisma.service';

interface TopCache {
  validUntil: number;
  set: Set<string>;
}

let cache: TopCache | null = null;
const TTL_MS = 5 * 60 * 1000;
const TOP_N = 100;

export async function tenantTopLabel(prisma: PrismaService, tenantId: string): Promise<string> {
  const now = Date.now();
  if (!cache || cache.validUntil < now) {
    cache = await refresh(prisma);
  }
  return cache.set.has(tenantId) ? tenantId : 'other';
}

async function refresh(prisma: PrismaService): Promise<TopCache> {
  try {
    const rows = await prisma.org.findMany({
      select: { id: true, _count: { select: { persons: true } } },
      orderBy: { persons: { _count: 'desc' } },
      take: TOP_N,
    });
    return {
      validUntil: Date.now() + TTL_MS,
      set: new Set(rows.map((r) => r.id)),
    };
  } catch {
    return { validUntil: Date.now() + TTL_MS, set: new Set() };
  }
}
