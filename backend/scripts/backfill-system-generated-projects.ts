import { Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

/* eslint-disable no-console */

interface Stats {
  matched: number;
  updated: number;
}

const ORG_CONTAINER_NAME = 'Спринт компании';

const ORG_CONTAINER_WHERE: Prisma.ProjectWhereInput = {
  name: ORG_CONTAINER_NAME,
  customerCardId: null,
  vendorId: null,
  subjectPersonId: null,
  departmentId: null,
  systemGenerated: false,
};

async function main(args: { dryRun: boolean }): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const stats: Stats = {
      matched: 0,
      updated: 0,
    };

    console.log(`=== backfill-system-generated-projects START (dryRun=${args.dryRun}) ===`);

    stats.matched = await prisma.project.count({ where: ORG_CONTAINER_WHERE });
    console.log(`  org-контейнеров «${ORG_CONTAINER_NAME}» найдено: ${stats.matched}`);

    if (args.dryRun) {
      console.log(`[DRY-RUN] would set systemGenerated=true for ${stats.matched} project(s)`);
    } else {
      const res = await prisma.project.updateMany({
        where: ORG_CONTAINER_WHERE,
        data: { systemGenerated: true },
      });
      stats.updated = res.count;
    }

    console.log('=== Итоги backfill-system-generated-projects ===');
    console.log(`  matched : ${stats.matched}`);
    console.log(`  updated : ${stats.updated}`);
    console.log(`  mode    : ${args.dryRun ? 'DRY-RUN' : 'REAL'}`);
  } finally {
    await prisma.$disconnect();
  }
}

const dryRun = process.argv.includes('--dry-run');
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-system-generated-projects FAILED:', err);
    process.exit(1);
  });

/* eslint-enable no-console */
