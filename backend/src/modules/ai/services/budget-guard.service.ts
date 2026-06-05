import { Inject, Injectable, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Результат оценки бюджета тенанта перед LLM-вызовом.
 *
 * - `over` — true только при `capKind='hard'` И MTD-расход ≥ месячного лимита.
 *   Для `soft`-cap всегда false (soft = только alert, не блок).
 * - `mtdRub` — month-to-date расход тенанта в рублях (сумма `AiUsageLog.costRub`).
 * - `capRub` — месячный лимит в рублях (null = без лимита).
 * - `capKind` — 'soft' | 'hard'.
 */
export interface BudgetEvaluation {
  over: boolean;
  mtdRub: number;
  capRub: number | null;
  capKind: string;
}

/**
 * ТЗ LLM cost-safety Ф2 — pre-dispatch проверка бюджета тенанта.
 *
 * Best-effort: ЛЮБАЯ ошибка (нет записи, недоступна БД, кривые данные) →
 * `over=false` (fail-open). Превышение бюджета не должно ронять основной
 * бизнес-поток; enforce включается отдельным флагом в LlmRouter.
 *
 * MTD-сумма кэшируется in-memory на TTL (по умолчанию 60с,
 * `llm.budget.mtd_cache_ttl_sec`), чтобы не агрегировать `AiUsageLog` на
 * каждый вызов LLM.
 */
@Injectable()
export class BudgetGuardService {
  private cache = new Map<string, { rub: number; fetchedAt: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * Оценить бюджет тенанта. Best-effort: любая ошибка → over=false (fail-open).
   * `tenantId=null` (system-jobs) не лимитируем.
   */
  async evaluate(tenantId: string | null): Promise<BudgetEvaluation> {
    const NONE: BudgetEvaluation = { over: false, mtdRub: 0, capRub: null, capKind: 'soft' };
    if (!tenantId) return NONE; // system-jobs не лимитируем
    try {
      const cap = await this.prisma.orgBudgetCap.findUnique({ where: { tenantId } });
      const capRub = cap?.monthlyCapRub != null ? Number(cap.monthlyCapRub) : null;
      const capKind = cap?.capKind ?? 'soft';
      if (capRub == null || !Number.isFinite(capRub) || capRub <= 0) {
        return { over: false, mtdRub: 0, capRub, capKind };
      }
      const mtdRub = await this.getMtdRub(tenantId);
      const over = capKind === 'hard' && mtdRub >= capRub;
      return { over, mtdRub, capRub, capKind };
    } catch {
      return NONE;
    }
  }

  private async getMtdRub(tenantId: string): Promise<number> {
    const ttlSec =
      (await this.cfg?.getDynamic<number>('llm.budget.mtd_cache_ttl_sec', undefined, 60)) ?? 60;
    const now = Date.now();
    const c = this.cache.get(tenantId);
    if (c && now - c.fetchedAt < ttlSec * 1000) return c.rub;
    const nowDate = new Date(now);
    const startOfMonth = new Date(
      Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1),
    );
    const agg = await this.prisma.aiUsageLog.aggregate({
      _sum: { costRub: true },
      where: { tenantId, createdAt: { gte: startOfMonth } },
    });
    const rub = Number(agg._sum.costRub ?? 0);
    this.cache.set(tenantId, { rub, fetchedAt: now });
    return rub;
  }
}
