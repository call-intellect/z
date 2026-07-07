import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface AutofillCandidate {
  blockId: string;
  score: number;
  embedding: number[];
}

export interface AutofillSelectOpts {
  threshold: number;
  maxPerScan: number;
  dedupeSimilarity: number;
}

export function cosineSim(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function selectAutofillCandidates(
  candidates: AutofillCandidate[],
  opts: AutofillSelectOpts,
): AutofillCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected: AutofillCandidate[] = [];
  for (const cand of sorted) {
    if (cand.score < opts.threshold) continue;
    if (selected.length >= opts.maxPerScan) break;
    const isDuplicate = selected.some(
      (chosen) => cosineSim(cand.embedding, chosen.embedding) >= opts.dedupeSimilarity,
    );
    if (isDuplicate) continue;
    selected.push(cand);
  }
  return selected;
}

interface CandidateRow {
  blockId: string;
  score: number | string;
  embedding: string;
}

@Injectable()
export class ThemeFillService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async fillTheme(args: {
    tenantId: string;
    themeId: string;
    opts: {
      threshold: number;
      scanWindowDays: number;
      maxPerScan: number;
      dedupeSimilarity: number;
    };
    now?: Date;
  }): Promise<{ added: number; addedBlockIds: string[] }> {
    const { tenantId, themeId, opts } = args;
    const empty = { added: 0, addedBlockIds: [] as string[] };

    const theme = await this.prisma.theme.findFirst({
      where: { id: themeId, tenantId },
      select: { id: true },
    });
    if (!theme) return empty;

    const embeddingRows = await this.prisma.$queryRawUnsafe<Array<{ embedding: string | null }>>(
      'SELECT embedding::text AS embedding FROM "Theme" WHERE id = $1 AND "tenantId" = $2',
      themeId,
      tenantId,
    );
    const themeEmbedding = parseVector(embeddingRows[0]?.embedding ?? null);
    if (!themeEmbedding) return empty;

    const now = args.now ?? new Date();
    const cutoff = new Date(now.getTime() - opts.scanWindowDays * 24 * 60 * 60 * 1000);
    const limit = opts.maxPerScan * 4;

    const rows = await this.prisma.$queryRawUnsafe<CandidateRow[]>(
      `
      SELECT b.id AS "blockId",
             (1 - (b.embedding <=> t.embedding)) AS score,
             b.embedding::text AS embedding
        FROM "IdeaBlock" b
        CROSS JOIN (SELECT embedding FROM "Theme" WHERE id = $1) t
       WHERE b."tenantId" = $2
         AND b.status = 'canonical'
         AND b.embedding IS NOT NULL
         AND b."createdAt" >= $3
         AND (b.embedding <=> t.embedding) <= (1 - $4)
         AND NOT EXISTS (
           SELECT 1 FROM "ThemeIdeaBlock" tib
            WHERE tib."themeId" = $1 AND tib."blockId" = b.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM "ThemeExclusion" te
            WHERE te."themeId" = $1 AND te.kind = 'block' AND te."blockId" = b.id
         )
       ORDER BY b.embedding <=> t.embedding ASC
       LIMIT $5
      `,
      themeId,
      tenantId,
      cutoff,
      opts.threshold,
      limit,
    );

    const candidates: AutofillCandidate[] = [];
    for (const row of rows) {
      const vec = parseVector(row.embedding);
      if (!vec) continue;
      const score = typeof row.score === 'number' ? row.score : Number(row.score);
      if (!Number.isFinite(score)) continue;
      candidates.push({ blockId: row.blockId, score, embedding: vec });
    }

    const selected = selectAutofillCandidates(candidates, {
      threshold: opts.threshold,
      maxPerScan: opts.maxPerScan,
      dedupeSimilarity: opts.dedupeSimilarity,
    });
    if (selected.length === 0) return empty;

    const selectedBlockIds = selected.map((c) => c.blockId);
    const reasonByBlockId = await this.buildReasons({
      tenantId,
      themeId,
      selected,
    });

    await this.prisma.themeIdeaBlock.createMany({
      data: selected.map((cand) => ({
        tenantId,
        themeId,
        blockId: cand.blockId,
        addedVia: 'autofill',
        score: new Prisma.Decimal(cand.score.toFixed(3)),
        reason: reasonByBlockId.get(cand.blockId) ?? null,
        weight: new Prisma.Decimal(cand.score.toFixed(3)),
      })),
      skipDuplicates: true,
    });

    return { added: selected.length, addedBlockIds: selectedBlockIds };
  }

  private async buildReasons(args: {
    tenantId: string;
    themeId: string;
    selected: AutofillCandidate[];
  }): Promise<Map<string, string>> {
    const { tenantId, themeId, selected } = args;
    const blockIds = selected.map((c) => c.blockId);

    const themeEntities = await this.prisma.themeEntity.findMany({
      where: { themeId, tenantId },
      select: { entityId: true },
    });
    const themeEntityIds = new Set(themeEntities.map((e) => e.entityId));

    const blockEntities = await this.prisma.ideaBlockEntity.findMany({
      where: { tenantId, blockId: { in: blockIds } },
      select: {
        blockId: true,
        entityId: true,
        entity: { select: { canonicalName: true } },
      },
    });

    const namesByBlockId = new Map<string, string[]>();
    for (const be of blockEntities) {
      if (!themeEntityIds.has(be.entityId)) continue;
      const list = namesByBlockId.get(be.blockId) ?? [];
      if (!list.includes(be.entity.canonicalName)) {
        list.push(be.entity.canonicalName);
      }
      namesByBlockId.set(be.blockId, list);
    }

    const reasons = new Map<string, string>();
    for (const cand of selected) {
      const scoreStr = cand.score.toFixed(2);
      const names = namesByBlockId.get(cand.blockId) ?? [];
      if (names.length > 0) {
        const shown = names.slice(0, 3).join(', ');
        reasons.set(cand.blockId, `Общие сущности: ${shown} · близость ${scoreStr}`);
      } else {
        reasons.set(cand.blockId, `Смысловая близость к теме ${scoreStr}`);
      }
    }
    return reasons;
  }
}

function parseVector(raw: string | null): number[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return null;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number.parseFloat(parts[i]!);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}
