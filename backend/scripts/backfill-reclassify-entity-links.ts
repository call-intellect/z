import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TypedConfigService } from '../src/common/config';
import { EntityGraphService } from '../src/modules/knowledge-core/services/entity-graph.service';
import { EntityLinkService } from '../src/modules/knowledge-core/services/entity-link.service';
import { SYMMETRIC_ENTITY_LINK_TYPES } from '../src/modules/knowledge-core/prompts/entity-graph-builder.prompt';

const POOL = 4;

function parseArgs(): { org: string | null; apply: boolean; minComentions: number | null } {
  let org: string | null = null;
  let apply = false;
  let minComentions: number | null = null;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--org=')) org = a.slice('--org='.length);
    else if (a === '--apply') apply = true;
    else if (a.startsWith('--min-comentions=')) minComentions = Number(a.slice('--min-comentions='.length));
  }
  return { org, apply, minComentions };
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const { org, apply, minComentions: minOverride } = parseArgs();
  if (!org) {
    console.error('Требуется --org=<tenantId>. Опц: --apply (иначе dry-run), --min-comentions=N');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const cfg = app.get(TypedConfigService);
  const graph = app.get(EntityGraphService);
  const entityLinks = app.get(EntityLinkService);

  const minComentions = minOverride ?? cfg.knowledgeCore.entityGraphMinComentions;
  const minConfidence = cfg.knowledgeCore.linkMinConfidence;
  console.log(
    `backfill-reclassify-entity-links · org=${org} · ${apply ? 'APPLY' : 'DRY-RUN'} · minComentions=${minComentions} · minConfidence=${minConfidence}`,
  );
  if (!apply) {
    console.log('DRY-RUN: граф (EntityLink) НЕ меняется, но judgeRelation зовёт LLM на каждой паре (расход бюджета + AiUsageLog).');
  }

  const pairRows = await prisma.$queryRawUnsafe<Array<{ a_id: string; b_id: string; co: bigint }>>(
    `
    SELECT a."entityId" AS a_id, b."entityId" AS b_id, COUNT(*)::bigint AS co
    FROM "IdeaBlockEntity" a
    JOIN "IdeaBlockEntity" b ON a."blockId" = b."blockId" AND a."entityId" < b."entityId"
    JOIN "IdeaBlock" blk ON blk.id = a."blockId"
    WHERE blk."tenantId" = $1 AND blk.status = 'canonical'
    GROUP BY a."entityId", b."entityId"
    HAVING COUNT(*) >= $2
    ORDER BY COUNT(*) DESC
    `,
    org,
    minComentions,
  );
  console.log(`Пар со-упоминаний (порог >=${minComentions}): ${pairRows.length}`);

  const ids = new Set<string>();
  for (const r of pairRows) {
    ids.add(r.a_id);
    ids.add(r.b_id);
  }
  const entities = await prisma.entity.findMany({ where: { id: { in: [...ids] } } });
  const entMap = new Map(entities.map((e) => [e.id, e]));

  type Outcome = 'enriched' | 'kept_mentions' | 'skipped_already' | 'skipped_none' | 'error';
  const stats: Record<Outcome, number> = {
    enriched: 0,
    kept_mentions: 0,
    skipped_already: 0,
    skipped_none: 0,
    error: 0,
  };
  const changes: string[] = [];

  await mapPool(pairRows, POOL, async (row) => {
    const a = entMap.get(row.a_id);
    const b = entMap.get(row.b_id);
    if (!a || !b || a.mergedIntoId !== null || b.mergedIntoId !== null) {
      stats.skipped_none += 1;
      return;
    }

    const existing = await prisma.entityLink.findMany({
      where: {
        tenantId: org,
        deletedAt: null,
        OR: [
          { fromEntityId: a.id, toEntityId: b.id },
          { fromEntityId: b.id, toEntityId: a.id },
        ],
      },
      select: { id: true, relationType: true },
    });
    if (existing.some((e) => e.relationType !== 'mentions_with')) {
      stats.skipped_already += 1;
      return;
    }

    try {
      const recentBlocks = await graph.findRecentSharedBlocks({
        entityAId: a.id,
        entityBId: b.id,
        limit: 5,
      });
      const verdict = await graph.judgeRelation({ tenantId: org, entityA: a, entityB: b, recentBlocks });
      if (verdict.relationType === null) {
        stats.skipped_none += 1;
        return;
      }
      if (verdict.relationType === 'mentions_with' || verdict.confidence < minConfidence) {
        stats.kept_mentions += 1;
        return;
      }
      const swap = verdict.direction === 'b_to_a' && !SYMMETRIC_ENTITY_LINK_TYPES.has(verdict.relationType);
      const fromEntityId = swap ? b.id : a.id;
      const toEntityId = swap ? a.id : b.id;
      const label = `${a.canonicalName} ↔ ${b.canonicalName} : ${verdict.relationType} (${swap ? 'b→a' : 'a→b'}) conf=${verdict.confidence.toFixed(2)}`;

      if (apply) {
        await entityLinks.upsertRichEdge({
          tenantId: org,
          fromEntityId,
          fromType: 'entity',
          toEntityId,
          toType: 'entity',
          relationType: verdict.relationType,
          confidence: verdict.confidence,
          explanation: verdict.explanation,
          createdBy: 'linker',
          attributes: verdict.attributes ?? null,
          sourceBlockIds: recentBlocks.map((blk) => blk.id),
          validFrom: null,
          validUntil: null,
        });
        const mentionIds = existing.filter((e) => e.relationType === 'mentions_with').map((e) => e.id);
        if (mentionIds.length > 0) {
          await prisma.entityLink.updateMany({
            where: { id: { in: mentionIds } },
            data: { status: 'archived', deletedAt: new Date() },
          });
        }
      }
      stats.enriched += 1;
      changes.push(label);
    } catch (e) {
      stats.error += 1;
      console.error(`  ошибка на паре ${a.canonicalName}↔${b.canonicalName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  console.log(`\n=== ИТОГ (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`Обогащено (mentions_with → точный тип): ${stats.enriched}`);
  console.log(`Оставлено mentions_with / low-conf: ${stats.kept_mentions}`);
  console.log(`Пропущено (уже обогащено): ${stats.skipped_already}`);
  console.log(`Пропущено (none/merged): ${stats.skipped_none}`);
  console.log(`Ошибок: ${stats.error}`);
  if (changes.length > 0) {
    console.log(`\nИзменения (${changes.length}):`);
    for (const c of changes.slice(0, 60)) console.log(`  • ${c}`);
    if (changes.length > 60) console.log(`  … и ещё ${changes.length - 60}`);
  }

  await app.close();
}

main().catch((e) => {
  console.error('BACKFILL ERROR:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
