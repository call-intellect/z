import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export function buildWhere(): Prisma.IdeaBlockEntityWhereInput {
  return {
    role: 'subject',
    block: {
      evidence: {
        some: { sourceType: 'chatbox' },
      },
    },
  };
}

export interface Stats {
  found: number;
  deleted: number;
}

export async function backfillChatboxSubjectCleanup(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = { found: 0, deleted: 0 };
  const where = buildWhere();

  console.log(`=== backfill-chatbox-subject-cleanup START (apply=${opts.apply}) ===`);

  if (!opts.apply) {
    const count = await prisma.ideaBlockEntity.count({ where });
    stats.found = count;
    console.log(`НАЙДЕНО ${count} ложных chatbox subject-связей (dry-run, не удаляю)`);
  } else {
    const res = await prisma.ideaBlockEntity.deleteMany({ where });
    stats.found = res.count;
    stats.deleted = res.count;
    console.log(`УДАЛЕНО ${res.count} ложных chatbox subject-связей`);
  }

  console.log('=== Итоги backfill-chatbox-subject-cleanup ===');
  console.log(`  found   : ${stats.found}`);
  console.log(`  deleted : ${stats.deleted}`);
  console.log(`  mode    : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillChatboxSubjectCleanup(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-chatbox-subject-cleanup FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
