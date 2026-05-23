import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA α-9 wave 3 — cardinality-safe tenant label для Prometheus.
 *
 * Возвращает один из:
 *   - tenantId (если входит в top-100 крупнейших Org по created RawEvent count)
 *   - 'other'
 *
 * Кеш в памяти на 5 минут — иначе каждое observation бы тянуло count Org'ов.
 */

interface TopCache {
  validUntil: number;
  set: Set<string>;
}

let cache: TopCache | null = null;
const TTL_MS = 5 * 60 * 1000;
const TOP_N = 100;

export async function tenantTopLabel(
  prisma: PrismaService,
  tenantId: string,
): Promise<string> {
  const now = Date.now();
  if (!cache || cache.validUntil < now) {
    cache = await refresh(prisma);
  }
  return cache.set.has(tenantId) ? tenantId : 'other';
}

async function refresh(prisma: PrismaService): Promise<TopCache> {
  // Топ-N по «активности» — берём top по числу Person'ов (стабильный прокси
  // для размера Org; не зависит от наличия RawEvent).
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

/** Принудительный сброс кеша (для тестов). */
export function resetTenantTopCache(): void {
  cache = null;
}
