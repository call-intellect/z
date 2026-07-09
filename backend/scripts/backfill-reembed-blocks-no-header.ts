import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { ExtractedBlock } from '../src/modules/knowledge-core/services/block-extraction.service';
import { EMBED_NO_HEADER_VERSION } from '../src/modules/knowledge-core/services/chunk-context.service';
import { KnowledgeEmbeddingService } from '../src/modules/knowledge-core/services/embedding.service';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH = 100;
const IDEA_BLOCK_HNSW_INDEX = 'IdeaBlock_embedding_hnsw_cosine_idx';

interface RunArgs {
  dryRun: boolean;
  orgId?: string;
  limit?: number;
  skipReindex: boolean;
}

export interface ReembedNoHeaderStats {
  scanned: number;
  reembedded: number;
  skippedEmpty: number;
  errors: number;
  reindexed: boolean;
}

export interface BlockRow {
  id: string;
  tenantId: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface ReembedNoHeaderDeps {
  countPending(orgId?: string): Promise<number>;
  fetchPending(args: { afterId: string; orgId?: string; take: number }): Promise<BlockRow[]>;
  embedBlocks(rows: BlockRow[]): Promise<number[][]>;
  writeBlock(args: { id: string; tenantId: string; vector: number[] }): Promise<void>;
  reindex(indexName: string): Promise<void>;
}

function parseArgs(argv: string[]): RunArgs {
  const orgArg = argv.find((a) => a.startsWith('--org='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const args: RunArgs = {
    dryRun: argv.includes('--dry-run'),
    skipReindex: argv.includes('--skip-reindex'),
  };
  if (orgArg) {
    const v = orgArg.split('=')[1];
    if (v) args.orgId = v;
  }
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      args.limit = Math.floor(n);
    }
  }
  return args;
}

function toExtractedBlock(row: BlockRow): ExtractedBlock {
  return {
    name: '',
    criticalQuestion: row.criticalQuestion,
    trustedAnswer: row.trustedAnswer,
    signalType: 'fact',
    tags: [],
    confidence: 1,
    evidenceQuote: '',
    evidenceStartMs: 0,
    evidenceEndMs: 0,
    mentionedEntities: [],
    role_relevant: false,
  } as ExtractedBlock;
}

export async function backfillReembedBlocksNoHeader(
  deps: ReembedNoHeaderDeps,
  opts: RunArgs,
): Promise<ReembedNoHeaderStats> {
  const stats: ReembedNoHeaderStats = {
    scanned: 0,
    reembedded: 0,
    skippedEmpty: 0,
    errors: 0,
    reindexed: false,
  };

  const pending = await deps.countPending(opts.orgId);
  if (pending === 0) {
    console.log(
      `[backfill-reembed-no-header] все canonical-блоки уже header-less (${EMBED_NO_HEADER_VERSION}) — already-present.`,
    );
    return stats;
  }
  console.log(`[backfill-reembed-no-header] блоков с header-ful embedding: ${pending}`);

  let cursor = '';
  let processed = 0;
  while (true) {
    if (opts.limit && processed >= opts.limit) break;
    const take = opts.limit ? Math.min(BATCH, opts.limit - processed) : BATCH;
    const rows = await deps.fetchPending({
      afterId: cursor,
      ...(opts.orgId ? { orgId: opts.orgId } : {}),
      take,
    });
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;

    const embeddable = rows.filter(
      (r) => `${r.criticalQuestion} ${r.trustedAnswer}`.trim().length > 0,
    );
    stats.scanned += rows.length;
    processed += rows.length;
    stats.skippedEmpty += rows.length - embeddable.length;

    if (embeddable.length === 0) {
      if (rows.length < take) break;
      continue;
    }

    if (opts.dryRun) {
      stats.reembedded += embeddable.length;
      if (rows.length < take) break;
      continue;
    }

    let vectors: number[][];
    try {
      vectors = await deps.embedBlocks(embeddable);
    } catch (err) {
      stats.errors += embeddable.length;
      console.warn(
        `[backfill-reembed-no-header] батч (${embeddable.length} блоков) — ошибка эмбеддинга: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (rows.length < take) break;
      continue;
    }

    for (let i = 0; i < embeddable.length; i++) {
      const block = embeddable[i]!;
      const vector = vectors[i];
      if (!vector || vector.length === 0) {
        stats.errors += 1;
        console.warn(`[backfill-reembed-no-header] blockId=${block.id}: пустой embedding`);
        continue;
      }
      try {
        await deps.writeBlock({ id: block.id, tenantId: block.tenantId, vector });
        stats.reembedded += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[backfill-reembed-no-header] blockId=${block.id}: ошибка записи — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rows.length < take) break;
  }

  if (!opts.dryRun && !opts.skipReindex && stats.reembedded > 0) {
    try {
      await deps.reindex(IDEA_BLOCK_HNSW_INDEX);
      stats.reindexed = true;
      console.log(`[backfill-reembed-no-header] REINDEX INDEX "${IDEA_BLOCK_HNSW_INDEX}" — ok`);
    } catch (err) {
      console.warn(
        `[backfill-reembed-no-header] REINDEX пропущен (${err instanceof Error ? err.message : String(err)}) — пересоберите HNSW вручную при необходимости.`,
      );
    }
  }

  return stats;
}

function makePrismaDeps(
  prisma: PrismaService,
  embeddings: KnowledgeEmbeddingService,
): ReembedNoHeaderDeps {
  return {
    async countPending(orgId?: string): Promise<number> {
      const params: unknown[] = [EMBED_NO_HEADER_VERSION];
      if (orgId) params.push(orgId);
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "IdeaBlock"
          WHERE "status" = 'canonical'
            AND "embedding" IS NOT NULL
            AND ("contextHeaderVersion" IS DISTINCT FROM $1)
            ${orgId ? 'AND "tenantId" = $2' : ''}`,
        ...params,
      );
      return Number(rows[0]?.n ?? 0n);
    },
    async fetchPending(args): Promise<BlockRow[]> {
      const params: unknown[] = [EMBED_NO_HEADER_VERSION, args.afterId];
      if (args.orgId) params.push(args.orgId);
      return prisma.$queryRawUnsafe<BlockRow[]>(
        `SELECT "id", "tenantId", "criticalQuestion", "trustedAnswer"
           FROM "IdeaBlock"
          WHERE "status" = 'canonical'
            AND "embedding" IS NOT NULL
            AND ("contextHeaderVersion" IS DISTINCT FROM $1)
            AND "id" > $2
            ${args.orgId ? 'AND "tenantId" = $3' : ''}
          ORDER BY "id" ASC
          LIMIT ${Math.max(1, Math.floor(args.take))}`,
        ...params,
      );
    },
    embedBlocks(rows): Promise<number[][]> {
      return embeddings.embedBlocks(rows.map(toExtractedBlock));
    },
    async writeBlock(args): Promise<void> {
      await prisma.$executeRawUnsafe(
        'UPDATE "IdeaBlock" SET embedding = $1::vector, "contextHeaderVersion" = $2 WHERE id = $3 AND "tenantId" = $4',
        `[${args.vector.join(',')}]`,
        EMBED_NO_HEADER_VERSION,
        args.id,
        args.tenantId,
      );
    },
    async reindex(indexName): Promise<void> {
      await prisma.$executeRawUnsafe(`REINDEX INDEX "${indexName}"`);
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `=== backfill-reembed-blocks-no-header START (dryRun=${args.dryRun}, org=${args.orgId ?? '<all>'}, limit=${args.limit ?? '<none>'}, skipReindex=${args.skipReindex}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const embeddings = app.get(KnowledgeEmbeddingService);
  const deps = makePrismaDeps(prisma, embeddings);

  try {
    const stats = await backfillReembedBlocksNoHeader(deps, args);
    console.log('=== Итоги backfill-reembed-blocks-no-header ===');
    console.log(`  scanned     : ${stats.scanned}`);
    console.log(`  reembedded  : ${stats.reembedded}`);
    console.log(`  skippedEmpty: ${stats.skippedEmpty}`);
    console.log(`  errors      : ${stats.errors}`);
    console.log(`  reindexed   : ${stats.reindexed}`);
    console.log(`  mode        : ${args.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await app.close();
  }
}

const isEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-reembed-blocks-no-header\.ts$/.test(process.argv[1] ?? '');

if (isEntry) {
  silenceRedisShutdownNoise();
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-reembed-blocks-no-header FAILED:', err);
      process.exit(1);
    });
}
