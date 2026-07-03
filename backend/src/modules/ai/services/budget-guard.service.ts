import { Inject, Injectable, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrencyRateService } from '../../admin/economics/currency-rate.service';

export interface BudgetEvaluation {
  over: boolean;
  mtdRub: number;
  capRub: number | null;
  capKind: string;
}

@Injectable()
export class BudgetGuardService {
  private cache = new Map<string, { rub: number; fetchedAt: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(CurrencyRateService)
    private readonly currencyRate?: CurrencyRateService,
  ) {}

  async evaluate(tenantId: string | null): Promise<BudgetEvaluation> {
    const NONE: BudgetEvaluation = { over: false, mtdRub: 0, capRub: null, capKind: 'soft' };
    if (!tenantId) return NONE;
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
    const startOfMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
    let fxRate: number;
    try {
      fxRate = (await this.currencyRate?.getCurrentUsdRubRate()) ?? 0;
    } catch {
      fxRate = 0;
    }
    const rows = await this.prisma.$queryRaw<Array<{ total_rub: string | null }>>`
      SELECT COALESCE(SUM(COALESCE("costRub", "costUsd" * ${fxRate})), 0)::text AS total_rub
      FROM "AiUsageLog"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${startOfMonth}
    `;
    const rub = Number.parseFloat(rows[0]?.total_rub ?? '0') || 0;
    this.cache.set(tenantId, { rub, fetchedAt: now });
    return rub;
  }
}
