import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface Stats {
  goalsScanned: number;
  recordedAtFixed: number;
}

const BATCH_SIZE = 200;

export async function backfillGoalV2Defaults(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = { goalsScanned: 0, recordedAtFixed: 0 };

  console.log(`=== backfill-goal-v2-defaults START (apply=${opts.apply}, batch=${BATCH_SIZE}) ===`);

  let cursorId: string | undefined = undefined;
  while (true) {
    const batch: { id: string; createdAt: Date }[] = (await prisma.goal.findMany({
      where: {
        validUntil: null,
        supersededById: null,
      },
      select: { id: true, createdAt: true, recordedAt: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    })) as unknown as { id: string; createdAt: Date; recordedAt: Date }[];

    if (batch.length === 0) break;

    for (const goal of batch as { id: string; createdAt: Date; recordedAt: Date }[]) {
      stats.goalsScanned++;
      if (goal.createdAt.getTime() === goal.recordedAt.getTime()) continue;

      if (opts.apply) {
        await prisma.goal.update({
          where: { id: goal.id },
          data: { recordedAt: goal.createdAt },
        });
      } else {
        console.log(
          `[DRY-RUN] would set recordedAt=${goal.createdAt.toISOString()} for goal ${goal.id}`,
        );
      }
      stats.recordedAtFixed++;
    }

    cursorId = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('=== Итоги backfill-goal-v2-defaults ===');
  console.log(`  goalsScanned     : ${stats.goalsScanned}`);
  console.log(`  recordedAtFixed  : ${stats.recordedAtFixed}`);
  console.log(`  mode             : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillGoalV2Defaults(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-goal-v2-defaults FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
