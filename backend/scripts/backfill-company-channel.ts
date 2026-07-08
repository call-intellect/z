import type { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../src/common/prisma/prisma.service';
import { ConversationService } from '../src/modules/messaging/services/conversation.service';

import { createPrismaClient } from './_lib/prisma';

export interface Counters {
  orgsScanned: number;
  created: number;
  ensured: number;
  skipped: number;
  failed: number;
}

async function pickCreatorUserId(
  prisma: PrismaClient,
  orgId: string,
): Promise<string | null> {
  const owner = await prisma.membership.findFirst({
    where: { orgId, role: 'owner', user: { deletedAt: null } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  if (owner) return owner.userId;

  const admin = await prisma.membership.findFirst({
    where: { orgId, role: 'admin', user: { deletedAt: null } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  if (admin) return admin.userId;

  const any = await prisma.membership.findFirst({
    where: { orgId, user: { deletedAt: null } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  return any?.userId ?? null;
}

export async function backfillCompanyChannel(
  prisma: PrismaClient,
  opts: { dryRun: boolean },
): Promise<Counters> {
  const service = new ConversationService(prisma as unknown as PrismaService);
  const counters: Counters = { orgsScanned: 0, created: 0, ensured: 0, skipped: 0, failed: 0 };

  console.log(`=== backfill-company-channel START (dryRun=${opts.dryRun}) ===`);

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  for (const org of orgs) {
    counters.orgsScanned++;
    try {
      const creatorUserId = await pickCreatorUserId(prisma, org.id);
      if (!creatorUserId) {
        counters.skipped++;
        console.log(`  org=${org.id} → пропуск (нет активных членов)`);
        continue;
      }

      const before = await prisma.conversation.findFirst({
        where: { tenantId: org.id, kind: 'channel', isMandatory: true },
        select: { id: true },
      });

      if (opts.dryRun) {
        console.log(
          `  org=${org.id} → ${before ? 'уже есть, донабор членов' : 'создать канал'} [dry-run]`,
        );
        if (before) counters.ensured++;
        else counters.created++;
        continue;
      }

      await service.ensureCompanyChannel(org.id, creatorUserId);
      if (before) counters.ensured++;
      else counters.created++;
    } catch (err) {
      counters.failed++;
      console.error(`  org=${org.id} FAILED`, err);
    }
  }

  console.log(
    `=== backfill-company-channel DONE ===\n` +
      `  orgsScanned: ${counters.orgsScanned}\n` +
      `  created:     ${counters.created}\n` +
      `  ensured:     ${counters.ensured}\n` +
      `  skipped:     ${counters.skipped}\n` +
      `  failed:      ${counters.failed}\n` +
      `  dryRun:      ${opts.dryRun}`,
  );

  return counters;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createPrismaClient();
  backfillCompanyChannel(prisma, { dryRun })
    .then(async (counters) => {
      await prisma.$disconnect();
      process.exit(counters.failed > 0 ? 1 : 0);
    })
    .catch(async (err: unknown) => {
      console.error('backfill-company-channel FATAL', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
