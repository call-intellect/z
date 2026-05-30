import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * DTO для KPI «Надёжность обещаний» (Commitment Reliability).
 *
 * Считается по `IdeaBlock` с `signalType='commitment'`. В числитель попадают
 * обещания, выполненные в окне (`fulfilled`); в знаменатель — все обещания
 * с истёкшим сроком в окне (`fulfilled + missed + overdue`). Активные ещё
 * не наступившие обещания (`pendingActive`) в reliability не учитываются,
 * но возвращаются отдельным полем для дашборда.
 *
 * `cancelled` и `superseded` в reliability НЕ учитываются (откат / замена).
 */
export interface CommitmentReliabilityDto {
  /** Параметры запроса для дебага/прозрачности. */
  scope: 'company' | 'team' | 'person';
  scopeId: string | null;
  windowDays: number;

  /** В окне [now-windowDays, now], commitmentDueDate в окне. */
  kept: number; // commitmentStatus='fulfilled'
  broken: number; // commitmentStatus='missed'
  overdue: number; // commitmentStatus IN ('open','asked') AND commitmentDueDate < now
  pendingActive: number; // commitmentStatus IN ('open','asked') AND commitmentDueDate >= now

  /** kept / max(1, kept+broken+overdue) * 100. */
  reliabilityPercent: number;

  /**
   * Дельта vs предыдущее окно той же длины. Может быть отрицательной.
   * null если в предыдущем окне знаменатель=0.
   */
  delta14d: number | null;

  /**
   * Массив из 12 значений reliabilityPercent по неделям, от старой к новой.
   * Если в неделе знаменатель=0, ставим null.
   */
  sparkline12w: Array<number | null>;
}

export interface CommitmentReliabilityArgs {
  tenantId: string;
  scope: 'company' | 'team' | 'person';
  /** Обязателен для 'team' и 'person'; игнорируется для 'company'. */
  scopeId?: string;
  /** Окно агрегации в днях. Default — 14. */
  windowDays?: number;
}

/** Минимальная проекция IdeaBlock для расчёта reliability. */
interface CommitmentRow {
  commitmentStatus: string | null;
  commitmentDueDate: Date | null;
}

const DEFAULT_WINDOW_DAYS = 14;
const SPARKLINE_WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_SECONDS = 5 * 60;

/**
 * CommitmentReliabilityService (Pulse Фаза 1.1).
 *
 * Read-only агрегат «Надёжность обещаний» для дашборда (KPI hero + drill-down).
 * Сервис не пересекается со `Specialist39PromiseKeeperService` (он формирует
 * probe-сообщения по просроченным) и `CommitmentFollowupCron` — он только
 * считает агрегаты для UI.
 *
 * Кэш — Redis с TTL 5 минут. На ошибки Redis сервис не падает, а считает live.
 */
@Injectable()
export class CommitmentReliabilityService {
  private readonly logger = new Logger(CommitmentReliabilityService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Публичный метод — фиксирует `now = new Date()` и делегирует в
   * `computeReliability`. Метод `computeReliability` оставлен public для
   * тестируемости (можно прокинуть детерминированный `now`).
   */
  async getReliability(
    args: CommitmentReliabilityArgs,
  ): Promise<CommitmentReliabilityDto> {
    return this.computeReliability(args, new Date());
  }

  /**
   * Чистая реализация (без `new Date()` внутри): принимает фиксированный `now`.
   * Используется тестами и публичным `getReliability`.
   */
  async computeReliability(
    args: CommitmentReliabilityArgs,
    now: Date,
  ): Promise<CommitmentReliabilityDto> {
    const windowDays = args.windowDays ?? DEFAULT_WINDOW_DAYS;
    this.validateScope(args);

    const scopeIdForKey = args.scope === 'company' ? null : (args.scopeId ?? null);
    const cacheKey = this.buildCacheKey(args.tenantId, args.scope, scopeIdForKey, windowDays);

    const cached = await this.tryReadCache(cacheKey);
    if (cached) {
      return cached;
    }

    const dto = await this.computeFromDb(args, now, windowDays, scopeIdForKey);

    await this.tryWriteCache(cacheKey, dto);

    return dto;
  }

  // ---------------------------------------------------------------------------
  // Внутреннее
  // ---------------------------------------------------------------------------

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
  ): string {
    return `commit_reliability:${tenantId}:${scope}:${scopeId ?? 'all'}:${windowDays}`;
  }

  private async tryReadCache(
    key: string,
  ): Promise<CommitmentReliabilityDto | null> {
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

  private async tryWriteCache(
    key: string,
    dto: CommitmentReliabilityDto,
  ): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(dto), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Делает ОДНУ выборку на весь горизонт `max(windowDays*2, SPARKLINE_WEEKS*7)`,
   * затем в JS раскладывает по bucket'ам:
   *   - текущее окно [now - windowDays, now]
   *   - предыдущее окно [now - 2*windowDays, now - windowDays]
   *   - 12 недельных bucket'ов от старой к новой
   *
   * В v1 'team' и 'person' фильтр идёт по `commitmentRecipientPersonId`
   * (адресат обещания), не по автору. Полноценный фильтр по автору
   * (через IdeaBlockEntity role='subject') — отдельная задача,
   * см. ТЗ Фазы 6.5 Promise Network.
   */
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

    // Текущее окно
    const curStart = new Date(now.getTime() - windowDays * DAY_MS);
    const curStats = this.bucketStats(rows, curStart, now, now);
    const reliabilityPercent = this.calcPercent(curStats);

    // Предыдущее окно [now - 2*windowDays, now - windowDays)
    const prevStart = new Date(now.getTime() - 2 * windowDays * DAY_MS);
    const prevEnd = curStart;
    const prevStats = this.bucketStats(rows, prevStart, prevEnd, now);
    const prevDenom = prevStats.kept + prevStats.broken + prevStats.overdue;
    const delta14d =
      prevDenom === 0 ? null : reliabilityPercent - this.calcPercent(prevStats);

    // Sparkline: 12 недель от старой к новой
    // index 0 — самая старая (заканчивается now - 11*7d)
    // index 11 — самая последняя завершившаяся неделя (заканчивается now)
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
    };

    if (args.scope === 'person') {
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

  /**
   * Считает 4 категории для окна `[start, end)` относительно `now`.
   * `now` нужен для разделения overdue (срок прошёл) и pendingActive (не наступил).
   */
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
      // cancelled / superseded / null — игнорируем
    }

    return { kept, broken, overdue, pendingActive };
  }

  private calcPercent(stats: {
    kept: number;
    broken: number;
    overdue: number;
  }): number {
    const denom = stats.kept + stats.broken + stats.overdue;
    if (denom === 0) return 0;
    return Math.round((stats.kept / denom) * 100);
  }
}
