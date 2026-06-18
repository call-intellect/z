import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ParticipantContextService } from '../src/modules/ai/services/participant-context.service';
import type { AiParticipantContext } from '../src/modules/ai/services/prompts/participant-context';
import { TaskAssigneeResolverService } from '../src/modules/knowledge-core/services/task-assignee-resolver.service';

interface RunArgs {
  dryRun: boolean;
}

interface Stats {
  processed: number;
  matchedExactlyOne: number;
  ambiguousDuplicateName: number;
  noMatch: number;
  participantsEmpty: number;
}

interface AmbiguousLog {
  meetingId: string;
  taskId: string;
  assigneeRaw: string;
  reason: 'duplicate_name' | 'participants_empty';
}

const BATCH_SIZE = 100;
const PROGRESS_LOG_EVERY = 500;

/* eslint-disable no-console */

async function main(args: RunArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const participantContext = app.get(ParticipantContextService);
    const resolver = app.get(TaskAssigneeResolverService);

    const stats: Stats = {
      processed: 0,
      matchedExactlyOne: 0,
      ambiguousDuplicateName: 0,
      noMatch: 0,
      participantsEmpty: 0,
    };
    const ambiguousLogs: AmbiguousLog[] = [];

    console.log(
      `=== backfill-task-assignee-userid START (dryRun=${args.dryRun}, batchSize=${BATCH_SIZE}) ===`,
    );

    const participantsCache = new Map<string, AiParticipantContext[]>();

    let cursorId: string | undefined = undefined;
    let nextProgressMark = PROGRESS_LOG_EVERY;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.task.findMany({
        where: {
          assigneeUserId: null,
          assigneeRaw: { not: null },
        },
        select: {
          id: true,
          meetingId: true,
          tenantId: true,
          assigneeRaw: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      const meetingIdsInBatch = new Set(batch.map((t) => t.meetingId));
      for (const meetingId of meetingIdsInBatch) {
        if (participantsCache.has(meetingId)) continue;
        const participants = await participantContext.loadForMeeting(meetingId);
        participantsCache.set(meetingId, participants);
      }

      for (const task of batch) {
        stats.processed++;
        const participants = participantsCache.get(task.meetingId) ?? [];

        if (participants.length === 0) {
          stats.participantsEmpty++;
          ambiguousLogs.push({
            meetingId: task.meetingId,
            taskId: task.id,
            assigneeRaw: task.assigneeRaw ?? '',
            reason: 'participants_empty',
          });
          continue;
        }

        const assigneeRaw = task.assigneeRaw;
        if (!assigneeRaw || assigneeRaw.trim().length === 0) {
          stats.noMatch++;
          continue;
        }

        const [resolved] = resolver.resolve(
          [{ assigneeRaw, assigneeUserId: null }],
          participants,
          task.tenantId ?? null,
        );

        if (!resolved) {
          stats.noMatch++;
          continue;
        }

        if (resolved.assigneeUserId) {
          stats.matchedExactlyOne++;
          if (!args.dryRun) {
            await prisma.task.update({
              where: { id: task.id },
              data: { assigneeUserId: resolved.assigneeUserId },
            });
          } else {
            console.log(
              `[DRY-RUN] would set Task.assigneeUserId taskId=${task.id} meetingId=${task.meetingId} raw="${assigneeRaw}" → userId=${resolved.assigneeUserId}`,
            );
          }
        } else if (resolved.ambiguous) {
          stats.ambiguousDuplicateName++;
          ambiguousLogs.push({
            meetingId: task.meetingId,
            taskId: task.id,
            assigneeRaw,
            reason: 'duplicate_name',
          });
        } else {
          stats.noMatch++;
        }

        if (stats.processed >= nextProgressMark) {
          console.log(
            `  progress: processed=${stats.processed}, matched=${stats.matchedExactlyOne}, ambiguous=${stats.ambiguousDuplicateName}, no_match=${stats.noMatch}, participants_empty=${stats.participantsEmpty}`,
          );
          nextProgressMark += PROGRESS_LOG_EVERY;
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги backfill-task-assignee-userid ===');
    console.log(`  processed                 : ${stats.processed}`);
    console.log(`  matched_exactly_one       : ${stats.matchedExactlyOne}`);
    console.log(`  ambiguous_duplicate_name  : ${stats.ambiguousDuplicateName}`);
    console.log(`  no_match                  : ${stats.noMatch}`);
    console.log(`  participants_empty        : ${stats.participantsEmpty}`);
    console.log(`  mode                      : ${args.dryRun ? 'DRY-RUN (no writes)' : 'REAL'}`);

    if (ambiguousLogs.length > 0) {
      console.log('');
      console.log(`=== Ambiguous / participants_empty (${ambiguousLogs.length}) ===`);
      for (const log of ambiguousLogs) {
        console.log(
          `  meetingId=${log.meetingId} taskId=${log.taskId} raw="${log.assigneeRaw}" reason=${log.reason}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

const dryRun = process.argv.includes('--dry-run');
main({ dryRun })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-task-assignee-userid FAILED:', err);
    process.exit(1);
  });

/* eslint-enable no-console */
