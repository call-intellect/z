import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { TypedConfigService } from '../src/common/config/index';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EmbeddingFallbackService } from '../src/modules/embeddings/services/embedding-fallback.service';
import {
  buildMetaLine,
  CONTEXT_HEADER_VERSION,
  type ContextHeaderInput,
} from '../src/modules/knowledge-core/services/chunk-context.service';
import {
  isCompanyEntityType,
  makeContextHeaderInput,
  resolveContextHeaderTitle,
} from '../src/modules/knowledge-core/services/context-header-input';

import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH = 100;
const IDEA_BLOCK_HNSW_INDEX = 'IdeaBlock_embedding_hnsw_cosine_idx';

interface RunArgs {
  dryRun: boolean;
  tenantId?: string;
  limit?: number;
  skipReindex: boolean;
}

export interface BackfillContextHeaderStats {
  scanned: number;
  reembedded: number;
  skippedEmpty: number;
  errors: number;
  reindexed: boolean;
}

export interface OldBlockRow {
  id: string;
  tenantId: string;
  criticalQuestion: string;
  trustedAnswer: string;
}

export interface ReembedDeps {
  countOld(tenantId?: string): Promise<number>;
  fetchOld(args: { afterId: string; tenantId?: string; take: number }): Promise<OldBlockRow[]>;
  loadHeaderInput(args: { blockId: string; tenantId: string }): Promise<ContextHeaderInput>;
  headerEnabled(): Promise<boolean>;
  embed(texts: string[]): Promise<number[][]>;
  writeBlock(args: { id: string; tenantId: string; vector: number[] }): Promise<void>;
  reindex(indexName: string): Promise<void>;
}

function parseArgs(argv: string[]): RunArgs {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const args: RunArgs = {
    dryRun: argv.includes('--dry-run'),
    skipReindex: argv.includes('--skip-reindex'),
  };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) args.tenantId = v;
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

export function buildEmbedText(header: string, block: OldBlockRow): string {
  const body = `${block.criticalQuestion} ${block.trustedAnswer}`.trim();
  const h = header.trim();
  return h.length > 0 ? `${h}\n${body}` : body;
}

export async function backfillContextHeaderReembed(
  deps: ReembedDeps,
  opts: RunArgs,
): Promise<BackfillContextHeaderStats> {
  const stats: BackfillContextHeaderStats = {
    scanned: 0,
    reembedded: 0,
    skippedEmpty: 0,
    errors: 0,
    reindexed: false,
  };

  const pending = await deps.countOld(opts.tenantId);
  if (pending === 0) {
    console.log(
      `[backfill-context-header-reembed] все canonical-блоки уже на ${CONTEXT_HEADER_VERSION} — already-present.`,
    );
    return stats;
  }
  console.log(`[backfill-context-header-reembed] блоков со старым header: ${pending}`);

  const headerEnabled = await deps.headerEnabled().catch(() => true);

  let cursor = '';
  let processed = 0;
  while (true) {
    if (opts.limit && processed >= opts.limit) break;
    const take = opts.limit ? Math.min(BATCH, opts.limit - processed) : BATCH;
    const rows = await deps.fetchOld({
      afterId: cursor,
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      take,
    });
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    cursor = last.id;

    for (const block of rows) {
      stats.scanned += 1;
      processed += 1;
      try {
        const input = await deps.loadHeaderInput({ blockId: block.id, tenantId: block.tenantId });
        const header = headerEnabled ? buildMetaLine(input) : '';
        const text = buildEmbedText(header, block);
        if (text.length === 0) {
          stats.skippedEmpty += 1;
          continue;
        }
        if (opts.dryRun) {
          stats.reembedded += 1;
          continue;
        }
        const vectors = await deps.embed([text]);
        const vector = vectors[0];
        if (!vector || vector.length === 0) {
          stats.errors += 1;
          console.warn(`[backfill-context-header-reembed] blockId=${block.id}: пустой embedding`);
          continue;
        }
        await deps.writeBlock({ id: block.id, tenantId: block.tenantId, vector });
        stats.reembedded += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[backfill-context-header-reembed] blockId=${block.id}: ошибка — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (rows.length < take) break;
  }

  if (!opts.dryRun && !opts.skipReindex && stats.reembedded > 0) {
    try {
      await deps.reindex(IDEA_BLOCK_HNSW_INDEX);
      stats.reindexed = true;
      console.log(`[backfill-context-header-reembed] REINDEX INDEX "${IDEA_BLOCK_HNSW_INDEX}" — ok`);
    } catch (err) {
      console.warn(
        `[backfill-context-header-reembed] REINDEX пропущен (${err instanceof Error ? err.message : String(err)}) — пересоберите HNSW вручную при необходимости.`,
      );
    }
  }

  return stats;
}

async function loadHeaderInputFromDb(
  prisma: PrismaService,
  blockId: string,
  tenantId: string,
): Promise<ContextHeaderInput> {
  const evidence = await prisma.ideaBlockEvidence.findFirst({
    where: { blockId, tenantId },
    select: { rawEventId: true },
    orderBy: { sourceTimestamp: 'asc' },
  });
  const rawEventId = evidence?.rawEventId;
  if (!rawEventId) return makeContextHeaderInput({});

  const rawEvent = await prisma.rawEvent.findUnique({
    where: { id: rawEventId },
    select: { sourceTitle: true, sourceExternalId: true, sourceType: true, occurredAt: true },
  });

  const participantRows = await prisma.sourceParticipant.findMany({
    where: { rawEventId, tenantId },
    select: { person: { select: { name: true } } },
  });
  const participants = participantRows
    .map((p) => p.person?.name ?? '')
    .filter((n) => n.trim().length > 0);

  const entityRows = await prisma.sourceEntity.findMany({
    where: { rawEventId, tenantId },
    select: { entity: { select: { canonicalName: true, type: true } } },
  });
  const companies = entityRows
    .filter((e) => e.entity != null && isCompanyEntityType(e.entity.type))
    .map((e) => e.entity?.canonicalName ?? '')
    .filter((n) => n.trim().length > 0);

  const title = resolveContextHeaderTitle({
    sourceTitle: rawEvent?.sourceTitle ?? null,
    payloadTitle: null,
    sourceExternalId: rawEvent?.sourceExternalId ?? null,
    fallback: `${rawEvent?.sourceType ?? 'source'}:${rawEventId}`,
  });

  return makeContextHeaderInput({
    sourceTitle: title,
    companies,
    participants,
    meetingType: null,
    meetingDateIso: rawEvent?.occurredAt ? rawEvent.occurredAt.toISOString() : null,
  });
}

function makePrismaDeps(
  prisma: PrismaService,
  embeddings: EmbeddingFallbackService,
  cfg: TypedConfigService,
): ReembedDeps {
  return {
    async countOld(tenantId?: string): Promise<number> {
      const params: unknown[] = [CONTEXT_HEADER_VERSION];
      if (tenantId) params.push(tenantId);
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*)::bigint AS n FROM "IdeaBlock"
          WHERE "status" = 'canonical'
            AND "embedding" IS NOT NULL
            AND ("contextHeaderVersion" IS DISTINCT FROM $1)
            ${tenantId ? 'AND "tenantId" = $2' : ''}`,
        ...params,
      );
      return Number(rows[0]?.n ?? 0n);
    },
    async fetchOld(args): Promise<OldBlockRow[]> {
      const params: unknown[] = [CONTEXT_HEADER_VERSION, args.afterId];
      if (args.tenantId) params.push(args.tenantId);
      return prisma.$queryRawUnsafe<OldBlockRow[]>(
        `SELECT "id", "tenantId", "criticalQuestion", "trustedAnswer"
           FROM "IdeaBlock"
          WHERE "status" = 'canonical'
            AND "embedding" IS NOT NULL
            AND ("contextHeaderVersion" IS DISTINCT FROM $1)
            AND "id" > $2
            ${args.tenantId ? 'AND "tenantId" = $3' : ''}
          ORDER BY "id" ASC
          LIMIT ${Math.max(1, Math.floor(args.take))}`,
        ...params,
      );
    },
    loadHeaderInput(args): Promise<ContextHeaderInput> {
      return loadHeaderInputFromDb(prisma, args.blockId, args.tenantId);
    },
    headerEnabled(): Promise<boolean> {
      return cfg.getDynamic<boolean>('knowledge.contextual_header_enabled', undefined, true);
    },
    embed(texts): Promise<number[][]> {
      return embeddings.embed(texts);
    },
    async writeBlock(args): Promise<void> {
      await prisma.$executeRawUnsafe(
        'UPDATE "IdeaBlock" SET embedding = $1::vector(768), "contextHeaderVersion" = $2 WHERE id = $3 AND "tenantId" = $4',
        `[${args.vector.join(',')}]`,
        CONTEXT_HEADER_VERSION,
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
    `=== backfill-context-header-reembed START (dryRun=${args.dryRun}, tenant=${args.tenantId ?? '<all>'}, limit=${args.limit ?? '<none>'}, skipReindex=${args.skipReindex}) ===`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const embeddings = app.get(EmbeddingFallbackService);
  const cfg = app.get(TypedConfigService);
  const deps = makePrismaDeps(prisma, embeddings, cfg);

  try {
    const stats = await backfillContextHeaderReembed(deps, args);
    console.log('=== Итоги backfill-context-header-reembed ===');
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
  /backfill-context-header-reembed\.ts$/.test(process.argv[1] ?? '');

if (isEntry) {
  silenceRedisShutdownNoise();
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-context-header-reembed FAILED:', err);
      process.exit(1);
    });
}
