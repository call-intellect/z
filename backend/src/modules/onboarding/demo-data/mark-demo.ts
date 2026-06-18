import type { PrismaClient } from '@prisma/client';

export const DEMO_EXTERNAL_SOURCE = 'demo';

const DEMO_TENANT_TABLES = [
  'department',
  'role',
  'person',
  'appointment',
  'companyProfile',
  'functionalDomain',

  'project',
  'projectDocument',
  'issueState',
  'cycle',
  'sprintHint',

  'ideaBlock',
  'entity',
  'theme',
  'goal',
  'goalAlignmentSnapshot',

  'process',
  'processStep',
  'decision',
  'insight',

  'notification',
  'chatV2Conversation',

  'dailyCheckIn',
  'weeklyOperationsDigest',
  'dailyOperationsDigest',

  'skillProfile',
  'executablePersona',
  'cloneAccessGrant',

  'helpfulnessSpotlight',
  'recognition',
  'card',
] as const;

export async function markAllDemoEntitiesForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ updated: number }> {
  let updated = 0;
  for (const table of DEMO_TENANT_TABLES) {
    const delegate = (
      prisma as unknown as Record<
        string,
        {
          updateMany(args: {
            where: { tenantId: string; externalSource: null };
            data: { externalSource: string };
          }): Promise<{ count: number }>;
        }
      >
    )[table];
    if (!delegate || typeof delegate.updateMany !== 'function') continue;
    const res = await delegate.updateMany({
      where: { tenantId, externalSource: null },
      data: { externalSource: DEMO_EXTERNAL_SOURCE },
    });
    updated += res.count;
  }
  return { updated };
}
