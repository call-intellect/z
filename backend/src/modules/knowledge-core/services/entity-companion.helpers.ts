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
