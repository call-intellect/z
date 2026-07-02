import type { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;

export async function setPersonEntity(
  client: Client,
  personId: string,
  entity: { id: string; tenantId: string },
): Promise<void> {
  await client.person.update({
    where: { id: personId },
    data: { entityId: entity.id, entityTenantId: entity.tenantId },
  });
}

export async function markEntityMerged(
  tx: Client,
  from: { id: string; tenantId: string },
  into: { id: string; tenantId: string },
): Promise<void> {
  await tx.entity.update({
    where: { id_tenantId: { id: from.id, tenantId: from.tenantId } },
    data: { mergedIntoId: into.id, mergedIntoTenantId: into.tenantId },
  });
}

export async function markBlockMerged(
  tx: Client,
  block: { id: string; tenantId: string },
  canonical: { id: string; tenantId: string },
): Promise<void> {
  await tx.ideaBlock.update({
    where: { id_tenantId: { id: block.id, tenantId: block.tenantId } },
    data: {
      status: 'merged_into',
      mergedIntoId: canonical.id,
      mergedIntoTenantId: canonical.tenantId,
    },
  });
}

const CANONICALIZE_MAX_HOPS = 16;

export async function canonicalizeEntityId(
  client: Client,
  tenantId: string,
  entityId: string,
): Promise<string> {
  let cur = entityId;
  const visited = new Set<string>();
  for (let hop = 0; hop < CANONICALIZE_MAX_HOPS; hop++) {
    if (visited.has(cur)) return cur;
    visited.add(cur);
    const row = await client.entity.findUnique({
      where: { id_tenantId: { id: cur, tenantId } },
      select: { mergedIntoId: true },
    });
    if (!row) return cur;
    if (row.mergedIntoId === null) return cur;
    cur = row.mergedIntoId;
  }
  return cur;
}

export async function canonicalizeEntityIds(
  client: Client,
  tenantId: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (entityIds.length === 0) return out;
  const resolved = new Map<string, string>();
  for (const origId of new Set(entityIds)) {
    let cur = origId;
    const chain: string[] = [];
    const visited = new Set<string>();
    let canonical: string | null = null;
    for (let hop = 0; hop < CANONICALIZE_MAX_HOPS; hop++) {
      const memo = resolved.get(cur);
      if (memo !== undefined) {
        canonical = memo;
        break;
      }
      if (visited.has(cur)) {
        canonical = cur;
        break;
      }
      visited.add(cur);
      chain.push(cur);
      const row = await client.entity.findUnique({
        where: { id_tenantId: { id: cur, tenantId } },
        select: { mergedIntoId: true },
      });
      if (!row || row.mergedIntoId === null) {
        canonical = cur;
        break;
      }
      cur = row.mergedIntoId;
    }
    if (canonical === null) canonical = cur;
    for (const node of chain) resolved.set(node, canonical);
    out.set(origId, canonical);
  }
  return out;
}
