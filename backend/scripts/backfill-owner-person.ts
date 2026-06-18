import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface Stats {
  membershipsScanned: number;
  personsCreated: number;
  personsLinked: number;
  membershipsUpdated: number;
}

const BATCH_SIZE = 200;

async function ensurePerson(
  prisma: PrismaClient,
  args: { tenantId: string; userId: string; personId: string | null },
  apply: boolean,
  stats: Stats,
): Promise<string | null> {
  if (args.personId) return args.personId;

  const existing = await prisma.person.findFirst({
    where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { email: true, name: true },
  });
  const email = user?.email ?? '';

  if (!apply) {
    console.log(
      `[DRY-RUN] would create Person tenantId=${args.tenantId} userId=${args.userId} email=${email}`,
    );
    stats.personsCreated++;
    return null;
  }

  try {
    const created = await prisma.person.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        name: user?.name ?? '',
        email,
        relationship: 'employee',
      },
      select: { id: true },
    });
    stats.personsCreated++;
    return created.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.person.findFirst({
        where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
        select: { id: true },
      });
      if (raced) return raced.id;
      if (email) {
        const byEmail = await prisma.person.findFirst({
          where: { tenantId: args.tenantId, email, deletedAt: null },
          select: { id: true, userId: true },
        });
        if (byEmail && byEmail.userId === null) {
          await prisma.person.update({
            where: { id: byEmail.id },
            data: { userId: args.userId },
          });
          stats.personsLinked++;
          return byEmail.id;
        }
      }
    }
    throw err;
  }
}

export async function backfillOwnerPerson(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = {
    membershipsScanned: 0,
    personsCreated: 0,
    personsLinked: 0,
    membershipsUpdated: 0,
  };

  console.log(`=== backfill-owner-person START (apply=${opts.apply}, batch=${BATCH_SIZE}) ===`);

  let cursorId: string | undefined = undefined;
  while (true) {
    const batch: {
      id: string;
      orgId: string;
      userId: string;
      personId: string | null;
    }[] = await prisma.membership.findMany({
      where: { personId: null },
      select: { id: true, orgId: true, userId: true, personId: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });

    if (batch.length === 0) break;

    for (const m of batch) {
      stats.membershipsScanned++;
      const personId = await ensurePerson(
        prisma,
        { tenantId: m.orgId, userId: m.userId, personId: m.personId },
        opts.apply,
        stats,
      );

      if (opts.apply) {
        if (!personId) continue;
        await prisma.membership.update({
          where: { id: m.id },
          data: { personId },
        });
      } else {
        console.log(`[DRY-RUN] would set membership ${m.id}.personId=${personId ?? '<new>'}`);
      }
      stats.membershipsUpdated++;
    }

    cursorId = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('=== Итоги backfill-owner-person ===');
  console.log(`  membershipsScanned : ${stats.membershipsScanned}`);
  console.log(`  personsCreated     : ${stats.personsCreated}`);
  console.log(`  personsLinked      : ${stats.personsLinked}`);
  console.log(`  membershipsUpdated : ${stats.membershipsUpdated}`);
  console.log(`  mode               : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillOwnerPerson(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-owner-person FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
