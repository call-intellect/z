import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { Specialist36Service } from '../src/modules/knowledge-core/services/specialist-3-6-ideas.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface IdeaSupporterLike {
  kind?: unknown;
  entityId?: unknown;
}

function short(id: string): string {
  return id.slice(0, 8);
}

function parseSupporterArray(payload: Prisma.JsonValue): IdeaSupporterLike[] {
  if (!Array.isArray(payload)) return [];
  const out: IdeaSupporterLike[] = [];
  for (const item of payload) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      out.push(item as IdeaSupporterLike);
    }
  }
  return out;
}

function mergeSupporters(
  a: Prisma.JsonValue,
  b: Prisma.JsonValue,
): IdeaSupporterLike[] {
  const seen = new Map<string, IdeaSupporterLike>();
  for (const s of [...parseSupporterArray(a), ...parseSupporterArray(b)]) {
    const kind = typeof s.kind === 'string' ? s.kind : 'person';
    const entityId = typeof s.entityId === 'string' ? s.entityId : '';
    if (!entityId) continue;
    const key = `${kind}:${entityId}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

interface PairRow {
  id_a: string;
  id_b: string;
  distance: number;
}

interface IdeaForMerge {
  id: string;
  firstProposedAt: Date;
  createdAt: Date;
  statement: string;
  sourceBlockIds: string[];
  supporters: Prisma.JsonValue;
  supporterCount: number;
  status: string;
  realizedAsDecisionId: string | null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const applyMerge = argv.includes('--apply');

  console.log(
    `=== backfill-idea-quality START (dryRun=${dryRun}, applyMerge=${applyMerge}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const cfg = app.get(TypedConfigService);
    const specialist = app.get(Specialist36Service);

    const candidates = await prisma.idea.findMany({
      where: {
        createdByUserId: null,
        rationale: null,
        status: { notIn: ['rejected', 'archived'] },
      },
      select: { id: true, tenantId: true },
    });
    console.log(`re-extract candidates: ${candidates.length}`);

    if (dryRun) {
      for (const c of candidates.slice(0, 20)) {
        console.log(`[DRY-RUN] candidate idea=${short(c.id)} tenant=${short(c.tenantId)}`);
      }
    } else {
      let updated = 0;
      let skipped = 0;
      let noBlock = 0;
      let notIdea = 0;
      let failed = 0;
      for (const c of candidates) {
        try {
          const r = await specialist.reextractIdeaForBackfill({
            tenantId: c.tenantId,
            ideaId: c.id,
          });
          if (r === 'updated') updated++;
          else if (r === 'skipped') skipped++;
          else if (r === 'no_block') noBlock++;
          else notIdea++;
        } catch (err) {
          failed++;
          console.warn(
            `[re-extract error] idea=${short(c.id)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(
        `re-extract: updated=${updated} skipped=${skipped} no_block=${noBlock} not_idea=${notIdea} failed=${failed}`,
      );
    }

    const threshold = await cfg.getDynamic<number>(
      'knowledge.ideaClusterThreshold',
      undefined,
      0.8,
    );
    const maxDistance = 1 - threshold;

    const tenants = await prisma.idea.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    const mode = applyMerge ? 'apply' : dryRun ? 'dry-run' : 'preview';
    const touched = new Set<string>();
    let pairsTotal = 0;
    let mergedCount = 0;
    let skippedPairs = 0;
    let mergeFailed = 0;

    for (const { tenantId } of tenants) {
      const pairs = await prisma.$queryRawUnsafe<PairRow[]>(
        `SELECT a."id" AS id_a, b."id" AS id_b, (a."embedding" <=> b."embedding") AS distance
         FROM "ideas" a
         JOIN "ideas" b ON a."id" < b."id"
         WHERE a."tenantId" = $1 AND b."tenantId" = $1
           AND a."embedding" IS NOT NULL AND b."embedding" IS NOT NULL
           AND a."status" IN ('captured','in_discussion')
           AND b."status" IN ('captured','in_discussion')
           AND (a."embedding" <=> b."embedding") <= $2
         ORDER BY distance ASC`,
        tenantId,
        maxDistance,
      );

      for (const pair of pairs) {
        pairsTotal++;
        const both = await prisma.idea.findMany({
          where: { id: { in: [pair.id_a, pair.id_b] } },
          select: {
            id: true,
            firstProposedAt: true,
            createdAt: true,
            statement: true,
            sourceBlockIds: true,
            supporters: true,
            supporterCount: true,
            status: true,
            realizedAsDecisionId: true,
          },
        });
        if (both.length !== 2) {
          skippedPairs++;
          continue;
        }
        const [x, y] = both as [IdeaForMerge, IdeaForMerge];
        let older: IdeaForMerge;
        let younger: IdeaForMerge;
        const xKey = x.firstProposedAt.getTime();
        const yKey = y.firstProposedAt.getTime();
        if (xKey < yKey || (xKey === yKey && x.createdAt.getTime() <= y.createdAt.getTime())) {
          older = x;
          younger = y;
        } else {
          older = y;
          younger = x;
        }
        const sim = 1 - Number(pair.distance);

        if (dryRun || !applyMerge) {
          console.log(
            `MERGE older=${short(older.id)} ← younger=${short(younger.id)} sim=${sim.toFixed(4)} | "${older.statement.slice(0, 50)}" ⇐ "${younger.statement.slice(0, 50)}"`,
          );
          continue;
        }

        if (
          touched.has(older.id) ||
          touched.has(younger.id) ||
          older.status === 'archived' ||
          younger.status === 'archived'
        ) {
          skippedPairs++;
          continue;
        }

        try {
          await prisma.$transaction(async (tx) => {
            const unionBlocks = Array.from(
              new Set([...older.sourceBlockIds, ...younger.sourceBlockIds]),
            );
            const merged = mergeSupporters(older.supporters, younger.supporters);
            await tx.idea.update({
              where: { id: older.id },
              data: {
                sourceBlockIds: { set: unionBlocks },
                supporters: merged as unknown as Prisma.InputJsonValue,
                supporterCount: Math.max(1, merged.length),
              },
            });
            await tx.idea.update({
              where: { id: younger.id },
              data: { status: 'archived' },
            });
          });
          touched.add(older.id);
          touched.add(younger.id);
          mergedCount++;
        } catch (err) {
          mergeFailed++;
          console.warn(
            `[merge error] older=${short(older.id)} younger=${short(younger.id)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    console.log(
      `merge: pairs=${pairsTotal} merged=${mergedCount} skipped=${skippedPairs} failed=${mergeFailed} (mode=${mode})`,
    );
  } finally {
    await app.close();
  }
}

silenceRedisShutdownNoise();
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-idea-quality FAILED:', err);
    process.exit(1);
  });
