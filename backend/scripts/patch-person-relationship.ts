import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

interface Counters {
  scanned: number;
  setEmployee: number;
  alreadyEmployee: number;
  externalKept: number;
}

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const counters: Counters = {
    scanned: 0,
    setEmployee: 0,
    alreadyEmployee: 0,
    externalKept: 0,
  };

  try {
    /* eslint-disable no-console */
    console.log(`=== patch-person-relationship START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`);

    let cursorId: string | undefined = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.person.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          relationship: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const p of batch) {
        counters.scanned++;

        if (!p.userId) {
          if (p.relationship === 'employee') {
            counters.alreadyEmployee++;
          } else {
            counters.externalKept++;
          }
          continue;
        }

        const membership = await prisma.membership.findFirst({
          where: { orgId: p.tenantId, userId: p.userId },
          select: { id: true },
        });

        if (membership) {
          if (p.relationship === 'employee') {
            counters.alreadyEmployee++;
            continue;
          }
          counters.setEmployee++;
          if (!DRY_RUN) {
            await prisma.person.update({
              where: { id: p.id },
              data: { relationship: 'employee' },
            });
          }
        } else {
          counters.externalKept++;
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      console.log(`  ...обработан батч до id=${cursorId}, всего отсканировано=${counters.scanned}`);
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги patch-person-relationship ===');
    console.log(`  scanned          : ${counters.scanned}`);
    console.log(`  setEmployee      : ${counters.setEmployee}`);
    console.log(`  alreadyEmployee  : ${counters.alreadyEmployee}`);
    console.log(`  externalKept     : ${counters.externalKept}`);
    console.log(`  mode             : ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-person-relationship FAILED:', err);
  process.exit(1);
});
