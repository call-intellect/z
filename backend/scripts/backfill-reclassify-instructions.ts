import { createPrismaClient } from './_lib/prisma';

interface RunArgs {
  apply: boolean;
}

interface Stats {
  scanned: number;
  created: number;
  skippedExisting: number;
  errors: number;
}

function forRoleFromScope(scope: string | null): string | null {
  if (!scope) return null;
  const trimmed = scope.trim();
  if (!trimmed.startsWith('role:')) return null;
  const id = trimmed.slice('role:'.length).trim();
  return id ? id.slice(0, 120) : null;
}

async function main(args: RunArgs): Promise<void> {
  const prisma = createPrismaClient();
  const stats: Stats = {
    scanned: 0,
    created: 0,
    skippedExisting: 0,
    errors: 0,
  };

  try {
    // eslint-disable-next-line no-console
    console.log(`=== backfill-reclassify-instructions START (apply=${args.apply}) ===`);

    let cursor: string | undefined;
    const pageSize = 500;
    while (true) {
      const processes = await prisma.process.findMany({
        where: { scope: { startsWith: 'role:' } },
        select: {
          id: true,
          tenantId: true,
          name: true,
          description: true,
          scope: true,
          ownerPersonId: true,
          sourceBlockIds: true,
          personSubjectIds: true,
          dataClass: true,
          confidence: true,
          status: true,
        },
        orderBy: { id: 'asc' },
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (processes.length === 0) break;

      for (const p of processes) {
        stats.scanned++;
        try {
          const existing = await prisma.instruction.findUnique({
            where: { tenantId_name: { tenantId: p.tenantId, name: p.name } },
            select: { id: true },
          });
          if (existing) {
            stats.skippedExisting++;
            continue;
          }
          if (args.apply) {
            await prisma.instruction.create({
              data: {
                tenantId: p.tenantId,
                name: p.name,
                contentMd: p.description ?? p.name,
                statement: p.description ?? null,
                scope: p.scope ?? null,
                forRole: forRoleFromScope(p.scope),
                status: p.status,
                ownerPersonId: p.ownerPersonId ?? null,
                sourceBlockIds: p.sourceBlockIds,
                personSubjectIds: p.personSubjectIds,
                dataClass: p.dataClass,
                confidence: p.confidence ?? null,
              },
            });
          }
          stats.created++;
        } catch (err) {
          stats.errors++;
          // eslint-disable-next-line no-console
          console.warn(
            `[error] processId=${p.id} tenantId=${p.tenantId} name="${p.name}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      cursor = processes[processes.length - 1]?.id;
      // eslint-disable-next-line no-console
      console.log(
        `progress: scanned=${stats.scanned}, created=${stats.created}, skippedExisting=${stats.skippedExisting}, errors=${stats.errors}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `=== DONE (apply=${args.apply}) scanned=${stats.scanned}, created=${stats.created}, skippedExisting=${stats.skippedExisting}, errors=${stats.errors} ===`,
    );
    if (!args.apply && stats.created > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run] ${stats.created} инструкций будет создано. Повторите с --apply для записи.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

const apply = process.argv.includes('--apply');
main({ apply })
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-reclassify-instructions FAILED:', err);
    process.exit(1);
  });
