import { Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

/* eslint-disable no-console */

interface Stats {
  projectsScanned: number;
  defaultBoardsCreated: number;
  defaultBoardsAlreadyPresent: number;
  issuesUpdated: number;
  projectsSkippedNoIssues: number;
}

const BATCH_SIZE = 100;

async function main(args: { dryRun: boolean }): Promise<void> {
  const prisma = createPrismaClient();
  try {
    const stats: Stats = {
      projectsScanned: 0,
      defaultBoardsCreated: 0,
      defaultBoardsAlreadyPresent: 0,
      issuesUpdated: 0,
      projectsSkippedNoIssues: 0,
    };

    console.log(
      `=== backfill-default-board START (dryRun=${args.dryRun}, batch=${BATCH_SIZE}) ===`,
    );

    let cursorId: string | undefined = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.project.findMany({
        where: { deletedAt: null },
        select: { id: true, tenantId: true, name: true, identifier: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const project of batch) {
        stats.projectsScanned++;

        const existing = await prisma.board.findFirst({
          where: {
            projectId: project.id,
            tenantId: project.tenantId,
            isDefault: true,
            deletedAt: null,
          },
          select: { id: true },
        });

        let defaultBoardId: string;
        if (existing) {
          defaultBoardId = existing.id;
          stats.defaultBoardsAlreadyPresent++;
        } else {
          if (args.dryRun) {
            console.log(
              `[DRY-RUN] would create default board for project ${project.identifier} (${project.id})`,
            );
            continue;
          }
          try {
            const created = await prisma.board.create({
              data: {
                tenantId: project.tenantId,
                projectId: project.id,
                name: 'Доска',
                color: '#5EEAD4',
                sequence: 0,
                isDefault: true,
              },
              select: { id: true },
            });
            defaultBoardId = created.id;
            stats.defaultBoardsCreated++;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              const fallback = await prisma.board.findFirst({
                where: {
                  projectId: project.id,
                  tenantId: project.tenantId,
                  deletedAt: null,
                },
                orderBy: [{ isDefault: 'desc' }, { sequence: 'asc' }],
                select: { id: true },
              });
              if (!fallback) {
                console.warn(
                  `  [WARN] P2002 on project ${project.id} but no fallback board found, skipping issues update`,
                );
                continue;
              }
              defaultBoardId = fallback.id;
              stats.defaultBoardsAlreadyPresent++;
            } else {
              throw e;
            }
          }
        }

        if (args.dryRun) {
          const countWithoutBoard = await prisma.issue.count({
            where: {
              projectId: project.id,
              tenantId: project.tenantId,
              boardId: null,
            },
          });
          if (countWithoutBoard === 0) {
            stats.projectsSkippedNoIssues++;
          } else {
            console.log(
              `[DRY-RUN] would update ${countWithoutBoard} issues in project ${project.identifier} → boardId=${defaultBoardId}`,
            );
            stats.issuesUpdated += countWithoutBoard;
          }
        } else {
          const updated = await prisma.issue.updateMany({
            where: {
              projectId: project.id,
              tenantId: project.tenantId,
              boardId: null,
            },
            data: { boardId: defaultBoardId },
          });
          if (updated.count === 0) {
            stats.projectsSkippedNoIssues++;
          } else {
            stats.issuesUpdated += updated.count;
            console.log(
              `  project ${project.identifier} (${project.id}): ${updated.count} issues → boardId=${defaultBoardId}`,
            );
          }
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги backfill-default-board ===');
    console.log(`  projectsScanned              : ${stats.projectsScanned}`);
    console.log(`  defaultBoardsCreated         : ${stats.defaultBoardsCreated}`);
    console.log(`  defaultBoardsAlreadyPresent  : ${stats.defaultBoardsAlreadyPresent}`);
    console.log(`  issuesUpdated                : ${stats.issuesUpdated}`);
    console.log(`  projectsSkippedNoIssues      : ${stats.projectsSkippedNoIssues}`);
    console.log(`  mode                         : ${args.dryRun ? 'DRY-RUN' : 'REAL'}`);
  } finally {
    await prisma.$disconnect();
  }
}

const dryRun = process.argv.includes('--dry-run');
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-default-board FAILED:', err);
    process.exit(1);
  });

/* eslint-enable no-console */
