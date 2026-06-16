import { markAllDemoEntitiesForTenant } from '../src/modules/onboarding/demo-data/mark-demo';

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[audit Б3 mark-demo-data] start', { dryRun: opts.dryRun });

  const demoOrgs = await prisma.org.findMany({
    where: { demoWorkspaceSeededAt: { not: null } },
    select: { id: true, name: true, demoWorkspaceSeededAt: true },
  });
  console.log(`[audit Б3 mark-demo-data] demo-Org найдено: ${demoOrgs.length}`);

  let totalUpdated = 0;
  for (const org of demoOrgs) {
    if (opts.dryRun) {
      console.log(`[audit Б3 mark-demo-data] would mark org=${org.id} (${org.name})`);
      continue;
    }
    const { updated } = await markAllDemoEntitiesForTenant(prisma, org.id);
    totalUpdated += updated;
    console.log(`[audit Б3 mark-demo-data] org=${org.id} (${org.name}): updated=${updated}`);
  }

  console.log(`[audit Б3 mark-demo-data] done. Всего обновлено записей: ${totalUpdated}`);
}

main()
  .catch((err) => {
    console.error('[audit Б3 mark-demo-data] ERROR', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
