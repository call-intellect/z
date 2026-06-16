import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { completeCommitmentWhere } from '../../operations/utils/commitment-completeness';

export interface CommitmentReliabilityDto {
  scope: 'company' | 'team' | 'person';
  scopeId: string | null;
  windowDays: number;

  kept: number;
  broken: number;
  overdue: number;
  pendingActive: number;

  reliabilityPercent: number;

  reliabilityLowData: boolean;

  delta14d: number | null;

  sparkline12w: Array<number | null>;
}

export interface CommitmentReliabilityArgs {
  tenantId: string;
  scope: 'company' | 'team' | 'person';
  scopeId?: string;
  windowDays?: number;
  personMode?: 'recipient' | 'author';
}

interface CommitmentRow {
  commitmentStatus: string | null;
  commitmentDueDate: Date | null;
}

const DEFAULT_WINDOW_DAYS = 14;
const SPARKLINE_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 5 * 60;

@Injectable()
export class CommitmentReliabilityService {
  private readonly logger = new Logger(CommitmentReliabilityService.name);

  private static readonly DEFAULT_MIN_DENOMINATOR = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getReliability(args: CommitmentReliabilityArgs): Promise<CommitmentReliabilityDto> {
    return this.computeReliability(args, new Date());
  }

  async computeReliability(
    args: CommitmentReliabilityArgs,
    now: Date,
  ): Promise<CommitmentReliabilityDto> {
    const windowDays = args.windowDays ?? DEFAULT_WINDOW_DAYS;
    this.validateScope(args);

    const scopeIdForKey = args.scope === 'company' ? null : (args.scopeId ?? null);
    const cacheKey = this.buildCacheKey(
      args.tenantId,
      args.scope,
      scopeIdForKey,
      windowDays,
      args.personMode,
    );

    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const dto = await this.computeFromDb(args, now, windowDays, scopeIdForKey);

    await this.tryWriteCache(cacheKey, dto);

    return dto;
  }

  private validateScope(args: CommitmentReliabilityArgs): void {
    if (args.scope === 'person' || args.scope === 'team') {
      if (!args.scopeId || args.scopeId.length === 0) {
        throw new BadRequestException('scope_id_required');
      }
    }
  }

  private buildCacheKey(
    tenantId: string,
    scope: string,
    scopeId: string | null,
    windowDays: number,
    personMode?: 'recipient' | 'author',
  ): string {
    return `commit_reliability:${tenantId}:${scope}:${scopeId ?? 'all'}:${windowDays}:${personMode ?? 'recipient'}`;
  }

  private async tryReadCache(key: string): Promise<CommitmentReliabilityDto | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CommitmentReliabilityDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async tryWriteCache(key: string, dto: CommitmentReliabilityDto): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(dto), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async computeFromDb(
    args: CommitmentReliabilityArgs,
    now: Date,
    windowDays: number,
    scopeIdForResult: string | null,
  ): Promise<CommitmentReliabilityDto> {
    const horizonMs = Math.max(windowDays * 2 * DAY_MS, SPARKLINE_WEEKS * WEEK_MS);
    const horizonStart = new Date(now.getTime() - horizonMs);

    const where = this.buildWhere(args, horizonStart, now);

    const rows = (await this.prisma.ideaBlock.findMany({
      where,
      select: { commitmentStatus: true, commitmentDueDate: true },
    })) as CommitmentRow[];

    const curStart = new Date(now.getTime() - windowDays * DAY_MS);
    const curStats = this.bucketStats(rows, curStart, now, now);
    const reliabilityPercent = this.calcPercent(curStats);

    const minDenominator = await this.cfg.getDynamic<number>(
      'reliability.min_denominator',
      'RELIABILITY_MIN_DENOMINATOR',
      CommitmentReliabilityService.DEFAULT_MIN_DENOMINATOR,
    );
    const curDenom = curStats.kept + curStats.broken + curStats.overdue;
    const reliabilityLowData =
      reliabilityOrLowData(curStats.kept, curDenom, minDenominator) === null;

    const prevStart = new Date(now.getTime() - 2 * windowDays * DAY_MS);
    const prevEnd = curStart;
    const prevStats = this.bucketStats(rows, prevStart, prevEnd, now);
    const prevDenom = prevStats.kept + prevStats.broken + prevStats.overdue;
    const delta14d = prevDenom === 0 ? null : reliabilityPercent - this.calcPercent(prevStats);

    const sparkline12w: Array<number | null> = [];
    for (let i = SPARKLINE_WEEKS - 1; i >= 0; i -= 1) {
      const weekEnd = new Date(now.getTime() - i * WEEK_MS);
      const weekStart = new Date(weekEnd.getTime() - WEEK_MS);
      const weekStats = this.bucketStats(rows, weekStart, weekEnd, now);
      const denom = weekStats.kept + weekStats.broken + weekStats.overdue;
      sparkline12w.push(denom === 0 ? null : this.calcPercent(weekStats));
    }

    return {
      scope: args.scope,
      scopeId: scopeIdForResult,
      windowDays,
      kept: curStats.kept,
      broken: curStats.broken,
      overdue: curStats.overdue,
      pendingActive: curStats.pendingActive,
      reliabilityPercent,
      reliabilityLowData,
      delta14d,
      sparkline12w,
    };
  }

  private buildWhere(
    args: CommitmentReliabilityArgs,
    horizonStart: Date,
    now: Date,
  ): Prisma.IdeaBlockWhereInput {
    const base: Prisma.IdeaBlockWhereInput = {
      tenantId: args.tenantId,
      signalType: 'commitment',
      commitmentDueDate: { gte: horizonStart, lte: now },
      ...completeCommitmentWhere(),
    };

    if (args.scope === 'person') {
      if (args.personMode === 'author') {
        return { ...base, commitmentAuthorPersonId: args.scopeId };
      }
      return { ...base, commitmentRecipientPersonId: args.scopeId };
    }
    if (args.scope === 'team') {
      return {
        ...base,
        commitmentRecipient: { primaryDepartmentId: args.scopeId },
      };
    }
    return base;
  }

  private bucketStats(
    rows: CommitmentRow[],
    start: Date,
    end: Date,
    now: Date,
  ): { kept: number; broken: number; overdue: number; pendingActive: number } {
    let kept = 0;
    let broken = 0;
    let overdue = 0;
    let pendingActive = 0;

    const startMs = start.getTime();
    const endMs = end.getTime();
    const nowMs = now.getTime();

    for (const row of rows) {
      if (!row.commitmentDueDate) continue;
      const dueMs = row.commitmentDueDate.getTime();
      if (dueMs < startMs || dueMs > endMs) continue;

      const status = row.commitmentStatus;
      if (status === 'fulfilled') {
        kept += 1;
      } else if (status === 'missed') {
        broken += 1;
      } else if (status === 'open' || status === 'asked') {
        if (dueMs < nowMs) {
          overdue += 1;
        } else {
          pendingActive += 1;
        }
      }
    }

    return { kept, broken, overdue, pendingActive };
  }

  private calcPercent(stats: { kept: number; broken: number; overdue: number }): number {
    const denom = stats.kept + stats.broken + stats.overdue;
    if (denom === 0) return 0;
    return Math.round((stats.kept / denom) * 100);
  }
}

export function reliabilityOrLowData(kept: number, denom: number, minDenom: number): number | null {
  if (denom <= 0 || denom < minDenom) return null;
  return Math.round((kept / denom) * 100);
}
