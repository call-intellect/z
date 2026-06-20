import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

import { Specialist31Service } from './specialist-3-1-regulations.service';

type ConsolType = 'regulation' | 'process' | 'policy' | 'instruction';

type ConsolOutcome = 'merged' | 'kept' | 'skipped_human' | 'distinct' | 'skipped';

const TABLE_MAP: Record<ConsolType, string> = {
  regulation: '"regulations"',
  process: '"processes"',
  policy: '"policies"',
  instruction: '"instructions"',
};

const STATEMENT_COL: Record<ConsolType, string> = {
  regulation: '"statement"',
  process: '"description"',
  policy: '"contentMd"',
  instruction: '"statement"',
};

const DELEGATE_NAME: Record<ConsolType, 'regulation' | 'process' | 'policy' | 'instruction'> = {
  regulation: 'regulation',
  process: 'process',
  policy: 'policy',
  instruction: 'instruction',
};

@Injectable()
export class RegulationConsolidatorService {
  private readonly logger = new Logger(RegulationConsolidatorService.name);

  private static readonly LOOKBACK_DAYS = 7;
  private static readonly TICK_LIMIT = 50;
  private static readonly CANDIDATE_COSINE_MIN = 0.82;
  private static readonly NEGATIVE_TTL_SECONDS = 7 * 24 * 3600;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(Specialist31Service) private readonly specialist: Specialist31Service,
  ) {}

  private prismaDelegate(type: ConsolType): {
    findUnique: (args: unknown) => Promise<unknown>;
  } {
    switch (type) {
      case 'regulation':
        return this.prisma.regulation as never;
      case 'process':
        return this.prisma.process as never;
      case 'policy':
        return this.prisma.policy as never;
      case 'instruction':
        return this.prisma.instruction as never;
    }
  }

  private buildPairKey(type: ConsolType, idA: string, idB: string): string {
    const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
    return `regulation-consolidate:distinct:${type}:${lo}:${hi}`;
  }

  async markPairDistinct(type: ConsolType, idA: string, idB: string): Promise<void> {
    if (idA === idB) return;
    try {
      await this.redis.client.set(
        this.buildPairKey(type, idA, idB),
        '1',
        'EX',
        RegulationConsolidatorService.NEGATIVE_TTL_SECONDS,
      );
    } catch {
      // fail-open: negative-cache недоступен — не ломаем флоу.
    }
  }

  async isPairExcluded(type: ConsolType, idA: string, idB: string): Promise<boolean> {
    if (idA === idB) return true;
    try {
      const v = await this.redis.client.get(this.buildPairKey(type, idA, idB));
      if (v != null) return true;
    } catch {
      // fail-open: продолжаем к проверке человеко-решения в БД.
    }
    try {
      const decision = await this.prisma.curationDecision.findFirst({
        where: {
          decisionType: { in: ['reject', 'split'] },
          curationItem: {
            resourceType: type,
            resourceId: { in: [idA, idB] },
          },
        },
        select: { id: true },
      });
      if (decision) return true;
    } catch {
      // fail-open: не нашли человеко-решение — считаем пару не исключённой.
    }
    return false;
  }

  async findTopCandidate(
    tenantId: string,
    type: ConsolType,
    cardId: string,
  ): Promise<{ id: string; name: string; statement: string; scope: string | null } | null> {
    const table = TABLE_MAP[type];
    const statementCol = STATEMENT_COL[type];
    const scopeExpr = '"scope"';
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; statement: string | null; scope: string | null }>
    >(
      `
      SELECT b.id, b.name, b.statement, b.scope
      FROM ${table} a
      CROSS JOIN LATERAL (
        SELECT b2.id, b2.name, b2.${statementCol} AS statement, b2.${scopeExpr} AS scope,
               b2.embedding
        FROM ${table} b2
        WHERE b2."tenantId" = a."tenantId"
          AND b2.id <> a.id
          AND b2.status <> 'deprecated'
          AND b2.embedding IS NOT NULL
        ORDER BY b2.embedding <=> a.embedding
        LIMIT 1
      ) b
      WHERE a.id = $1
        AND a."tenantId" = $2
        AND a.embedding IS NOT NULL
        AND (1 - (b.embedding <=> a.embedding)) > $3
      LIMIT 1
      `,
      cardId,
      tenantId,
      RegulationConsolidatorService.CANDIDATE_COSINE_MIN,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      statement: row.statement ?? '',
      scope: row.scope ?? null,
    };
  }

  async consolidateCard(type: ConsolType, cardId: string): Promise<ConsolOutcome> {
    let enabled: boolean;
    try {
      enabled = this.cfg.aiFeatures.regulationConsolidatorEnabled !== false;
    } catch {
      enabled = true;
    }
    if (!enabled) return 'skipped';

    const card = (await this.prismaDelegate(type).findUnique({
      where: { id: cardId },
      include: { currentVersion: { select: { trustTier: true } } },
    })) as {
      id: string;
      tenantId: string;
      name: string;
      status: string;
      scope: string | null;
      statement?: string | null;
      description?: string | null;
      contentMd?: string | null;
      dataClass?: 'public' | 'internal' | 'sensitive' | 'private' | null;
      currentVersion?: { trustTier: string } | null;
    } | null;

    if (!card || card.status === 'deprecated') return 'skipped';

    if (card.currentVersion?.trustTier === 'human') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: 'regulation-consolidator',
        reason: 'skipped_human',
      });
      return 'skipped_human';
    }

    const cand = await this.findTopCandidate(card.tenantId, type, cardId);
    if (!cand) return 'kept';

    const candCard = (await this.prismaDelegate(type).findUnique({
      where: { id: cand.id },
      include: { currentVersion: { select: { trustTier: true } } },
    })) as { currentVersion?: { trustTier: string } | null } | null;
    if (candCard?.currentVersion?.trustTier === 'human') return 'kept';

    if (await this.isPairExcluded(type, cardId, cand.id)) return 'kept';

    const cardStatement =
      type === 'process'
        ? card.description ?? ''
        : type === 'policy'
          ? card.contentMd ?? ''
          : card.statement ?? '';

    const verdict = await this.specialist.judgeDuplicate({
      tenantId: card.tenantId,
      draft: {
        kind: type,
        name: card.name,
        statement: cardStatement,
        scope: card.scope ?? null,
      },
      candidates: [
        { id: cand.id, name: cand.name, statement: cand.statement, scope: cand.scope },
      ],
      dataClass: card.dataClass ?? 'internal',
      blockId: cardId,
    });

    if (
      (verdict.decision === 'merge' || verdict.decision === 'extension') &&
      verdict.targetId === cand.id
    ) {
      await this.applyMerge(type, cardId, cand.id);
      this.metrics.incCoreSpecialistSkipped({
        specialist: 'regulation-consolidator',
        reason: 'merged',
      });
      return 'merged';
    }

    await this.markPairDistinct(type, cardId, cand.id);
    return 'distinct';
  }

  private async applyMerge(
    type: ConsolType,
    loserId: string,
    canonicalId: string,
  ): Promise<void> {
    const delegateName = DELEGATE_NAME[type];
    const loser = (await this.prismaDelegate(type).findUnique({
      where: { id: loserId },
      select: { id: true, sourceBlockIds: true, currentVersionId: true } as never,
    })) as { id: string; sourceBlockIds: string[]; currentVersionId: string | null } | null;
    const canonical = (await this.prismaDelegate(type).findUnique({
      where: { id: canonicalId },
      select: {
        id: true,
        tenantId: true,
        sourceBlockIds: true,
        currentVersionId: true,
      } as never,
    })) as {
      id: string;
      tenantId: string;
      sourceBlockIds: string[];
      currentVersionId: string | null;
    } | null;

    if (!loser || !canonical) return;

    const last = await this.prisma.cardVersion.findFirst({
      where: { tenantId: canonical.tenantId, resourceType: type, resourceId: canonicalId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;
    const mergedSourceBlockIds = this.union(canonical.sourceBlockIds, loser.sourceBlockIds);
    const supportsVersionColumn = type === 'regulation' || type === 'instruction';

    await this.prisma.$transaction(async (tx) => {
      const cv = await tx.cardVersion.create({
        data: {
          tenantId: canonical.tenantId,
          resourceType: type,
          resourceId: canonicalId,
          version: nextVersion,
          payload: {
            changeReasonText: 'consolidate',
            mergedFromId: loserId,
          } as Prisma.InputJsonValue,
          changeReason: 'consolidate',
          trustTier: 'auto',
          previousVersionId: canonical.currentVersionId ?? null,
          createdByUserId: null,
        },
      });
      const txDelegates = tx as never as Record<
        ConsolType,
        { update: (a: unknown) => Promise<unknown> }
      >;
      await txDelegates[delegateName].update({
        where: { id: canonicalId },
        data: {
          sourceBlockIds: { set: mergedSourceBlockIds },
          currentVersionId: cv.id,
          ...(supportsVersionColumn ? { version: nextVersion } : {}),
        },
      });
      await txDelegates[delegateName].update({
        where: { id: loserId },
        data: { status: 'deprecated' },
      });
    });

    this.logger.debug(
      { type, loserId, canonicalId, nextVersion },
      'regulation-consolidator: merged',
    );
  }

  async consolidateTenant(
    tenantId: string,
    limit = 500,
  ): Promise<{ merged: number; scanned: number }> {
    let merged = 0;
    let scanned = 0;
    const types: ConsolType[] = ['regulation', 'process', 'policy', 'instruction'];
    for (const type of types) {
      const ids = await this.findCandidateCardIds(tenantId, type, limit, false);
      for (const cardId of ids) {
        scanned++;
        try {
          const outcome = await this.consolidateCard(type, cardId);
          if (outcome === 'merged') merged++;
        } catch (err) {
          this.logger.warn(
            {
              tenantId,
              type,
              cardId,
              err: err instanceof Error ? err.message : String(err),
            },
            'regulation-consolidator: consolidateCard упал — пропускаем',
          );
        }
      }
    }
    return { merged, scanned };
  }

  async findCandidateCardIds(
    tenantId: string,
    type: ConsolType,
    limit: number,
    withWindow = true,
  ): Promise<string[]> {
    const table = TABLE_MAP[type];
    const since = new Date(
      Date.now() - RegulationConsolidatorService.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const windowClause = withWindow ? 'AND a."updatedAt" >= $3' : '';
    const params: unknown[] = withWindow
      ? [tenantId, RegulationConsolidatorService.CANDIDATE_COSINE_MIN, since, limit]
      : [tenantId, RegulationConsolidatorService.CANDIDATE_COSINE_MIN, limit];
    const limitParam = withWindow ? '$4' : '$3';
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT a.id
      FROM ${table} a
      CROSS JOIN LATERAL (
        SELECT b.embedding
        FROM ${table} b
        WHERE b."tenantId" = a."tenantId"
          AND b.id <> a.id
          AND b.status <> 'deprecated'
          AND b.embedding IS NOT NULL
        ORDER BY b.embedding <=> a.embedding
        LIMIT 1
      ) nb
      WHERE a."tenantId" = $1
        AND a.status <> 'deprecated'
        AND a.embedding IS NOT NULL
        ${windowClause}
        AND (1 - (nb.embedding <=> a.embedding)) > $2
      LIMIT ${limitParam}
      `,
      ...params,
    );
    return rows.map((r) => r.id);
  }

  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }
}
