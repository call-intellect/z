import { NestFactory } from '@nestjs/core';
import type { SignalType } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EntityResolutionService } from '../src/modules/knowledge-core/services/entity-resolution.service';
import { SegmentBuilderService } from '../src/modules/knowledge-core/services/segment-builder.service';
import { S3Service } from '../src/modules/recordings/s3.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

interface Options {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
}

interface Stats {
  scanned: number;
  attributed: number;
  skipped: number;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));

  const opts: Options = { dryRun: argv.includes('--dry-run') };

  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      opts.limit = Math.floor(n);
    }
  }
  return opts;
}

function tryGetAuthorUserId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as { userId?: unknown }).userId;
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-commitment-author START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, ` +
      `limit=${opts.limit ?? '<none>'}) ===`,
  );

  const blockWhere = {
    status: 'canonical' as const,
    signalType: 'commitment' as SignalType,
    commitmentAuthorPersonId: null,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };
  const preCheck = createPrismaClient();
  try {
    const pending = await preCheck.ideaBlock.count({ where: blockWhere });
    if (pending === 0) {
      console.log(
        'backfill-commitment-author: нет canonical-обещаний без автора — backfill не требуется.',
      );
      return;
    }
    console.log(`backfill-commitment-author: кандидатов-блоков ${pending}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stats: Stats = {
    scanned: 0,
    attributed: 0,
    skipped: 0,
  };

  try {
    const prisma = app.get(PrismaService);
    const cfg = app.get(TypedConfigService);
    const segments = app.get(SegmentBuilderService);
    const entities = app.get(EntityResolutionService);
    const s3 = app.get(S3Service);

    const enabled = await cfg.getDynamic<boolean>(
      'knowledge.commitmentAuthorAttributionEnabled',
      undefined,
      true,
    );
    if (!enabled) {
      console.log(
        'backfill-commitment-author: knowledge.commitmentAuthorAttributionEnabled=false — пропуск (kill-switch).',
      );
      return;
    }

    const payloadCache = new Map<string, unknown>();
    const loadPayload = async (event: {
      id: string;
      payloadStorage: string;
      payload: unknown;
      payloadS3Key: string | null;
    }): Promise<unknown> => {
      if (payloadCache.has(event.id)) return payloadCache.get(event.id);
      let result: unknown;
      if (event.payloadStorage === 's3') {
        if (!event.payloadS3Key) {
          throw new Error(`RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`);
        }
        result = await s3.getJson<unknown>(event.payloadS3Key);
      } else {
        result = event.payload;
      }
      payloadCache.set(event.id, result);
      return result;
    };

    let cursorId: string | undefined = undefined;
    let processed = 0;
    while (true) {
      if (opts.limit && processed >= opts.limit) break;
      const take = opts.limit ? Math.min(BATCH_SIZE, opts.limit - processed) : BATCH_SIZE;

      const batch = await prisma.ideaBlock.findMany({
        where: blockWhere,
        select: { id: true, tenantId: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const block of batch) {
        stats.scanned++;
        processed++;
        try {
          const evidence = await prisma.ideaBlockEvidence.findFirst({
            where: { blockId: block.id },
            orderBy: { createdAt: 'asc' },
            select: { rawEventId: true, startMs: true },
          });
          if (!evidence) {
            stats.skipped++;
            continue;
          }

          const event = await prisma.rawEvent.findUnique({
            where: { id: evidence.rawEventId },
            select: {
              id: true,
              tenantId: true,
              payloadStorage: true,
              payload: true,
              payloadS3Key: true,
            },
          });
          if (!event) {
            stats.skipped++;
            continue;
          }

          const payload = await loadPayload(event);

          const authorUserId = tryGetAuthorUserId(payload);

          let speakerParticipantId: string | null = null;
          let speakerName: string | null = null;
          if (!authorUserId) {
            const segs = segments.buildSegments(payload);
            const evidenceStartMs = evidence.startMs ?? 0;
            const seg =
              segs.find(
                (s) => s.endMs > 0 && evidenceStartMs >= s.startMs && evidenceStartMs <= s.endMs,
              ) ?? null;
            speakerParticipantId = seg?.speakerParticipantId ?? null;
            speakerName = seg?.speakers?.[0] ?? null;
          }

          const authorPersonId = await entities.resolveSubjectPersonId(event.tenantId, {
            speakerParticipantId,
            speakerName,
            authorUserId,
          });
          if (!authorPersonId) {
            stats.skipped++;
            continue;
          }

          if (opts.dryRun) {
            console.log(
              `[DRY-RUN] would set IdeaBlock.commitmentAuthorPersonId blockId=${block.id} → ${authorPersonId}`,
            );
          } else {
            await prisma.ideaBlock.update({
              where: { id: block.id },
              data: { commitmentAuthorPersonId: authorPersonId },
            });
          }
          stats.attributed++;
        } catch (err) {
          stats.skipped++;
          console.warn(
            `[error] blockId=${block.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < take) break;
    }

    console.log('=== Итоги backfill-commitment-author ===');
    console.log(`  scanned    : ${stats.scanned}`);
    console.log(`  attributed : ${stats.attributed}`);
    console.log(`  skipped    : ${stats.skipped}`);
    console.log(`  mode       : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-commitment-author FAILED:', err);
    process.exit(1);
  });
