import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  computeCombinedSeverity,
  derivePersonRiskLevel,
  normalizeBusFactorLevel,
  type PersonRiskLevel,
  type SeverityLevel,
} from './knowledge-at-risk.scoring';

/**
 * TZ-1 Фаза 4.C (daily-value-engine) — KnowledgeAtRiskService.
 *
 * Синтез двух сигналов:
 *   - критичный bus-factor: категория знаний держится на одном соло-эксперте
 *     (`KnowledgeRiskSnapshot.riskLevel='critical'`, highConfidenceCount ≤ 1);
 *   - риск ухода носителя: его `Person.riskFlagsJson` / `engagementScore`.
 *
 * computeForTenant строит снимки `KnowledgeAtRiskSnapshot` и возвращает
 * critical/warning записи с менеджером носителя для push (cron). Носителю
 * НИЧЕГО не уходит (этика) — это решается в cron'е (push только руководителю).
 *
 * Без LLM — чистый SQL/TS + чистая `computeCombinedSeverity`.
 */
@Injectable()
export class KnowledgeAtRiskService {
  private readonly logger = new Logger(KnowledgeAtRiskService.name);

  /** Окно свежести bus-factor снимков (дней). */
  private static readonly SNAPSHOT_LOOKBACK_DAYS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Построить снимки знание-под-риском для Org. Идемпотентно: на каждый прогон
   * пишем новый снимок per category (история; запросы берут последний). Возвращает
   * критичные/повышенные записи с резолвом носителя (для push руководителю).
   */
  async computeForTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<{
    snapshots: number;
    atRisk: Array<{
      categoryName: string;
      soleExpertPersonId: string;
      combinedSeverity: SeverityLevel;
    }>;
  }> {
    // 1. Свежие critical bus-factor снимки (последний per category).
    const lookback = new Date(
      args.now.getTime() -
        KnowledgeAtRiskService.SNAPSHOT_LOOKBACK_DAYS * 86_400_000,
    );
    const rows = await this.prisma.knowledgeRiskSnapshot.findMany({
      where: {
        tenantId: args.tenantId,
        riskLevel: 'critical',
        snapshotAt: { gte: lookback },
      },
      orderBy: { snapshotAt: 'desc' },
      select: {
        categoryName: true,
        riskLevel: true,
        topExpertsJson: true,
        snapshotAt: true,
      },
      take: 1_000,
    });

    // Последний снимок per category.
    const latestByCategory = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByCategory.has(r.categoryName)) {
        latestByCategory.set(r.categoryName, r);
      }
    }
    if (latestByCategory.size === 0) {
      return { snapshots: 0, atRisk: [] };
    }

    // 2. Резолв соло-эксперта (первый из topExperts) + его риск ухода.
    const atRisk: Array<{
      categoryName: string;
      soleExpertPersonId: string;
      combinedSeverity: SeverityLevel;
    }> = [];
    let snapshots = 0;

    for (const [categoryName, snap] of latestByCategory) {
      const busFactor = normalizeBusFactorLevel(snap.riskLevel);
      const soleExpertPersonId = this.firstExpertPersonId(snap.topExpertsJson);

      let personRiskLevel: PersonRiskLevel | null = null;
      if (soleExpertPersonId) {
        personRiskLevel = await this.resolvePersonRisk({
          tenantId: args.tenantId,
          personId: soleExpertPersonId,
        });
      }
      const combinedSeverity = computeCombinedSeverity(
        busFactor,
        personRiskLevel,
      );

      await this.prisma.knowledgeAtRiskSnapshot.create({
        data: {
          tenantId: args.tenantId,
          categoryName,
          soleExpertPersonId: soleExpertPersonId ?? null,
          busFactorLevel: busFactor,
          personRiskLevel: personRiskLevel ?? null,
          combinedSeverity,
          snapshotAt: args.now,
        },
      });
      snapshots++;
      this.metrics.incKnowledgeAtRisk({ severity: combinedSeverity });

      if (
        (combinedSeverity === 'critical' || combinedSeverity === 'warning') &&
        soleExpertPersonId
      ) {
        atRisk.push({ categoryName, soleExpertPersonId, combinedSeverity });
      }
    }

    return { snapshots, atRisk };
  }

  /**
   * Чтение для эндпоинта `GET /dashboard/operations/knowledge-at-risk`.
   * Последний снимок per category, сортировка critical → warning → ok.
   */
  async listForTenant(args: { tenantId: string; limit?: number }): Promise<{
    items: Array<{
      categoryName: string;
      soleExpertPersonId: string | null;
      soleExpertPersonName: string | null;
      busFactorLevel: string;
      personRiskLevel: string | null;
      combinedSeverity: string;
      snapshotAt: string;
    }>;
  }> {
    const rows = await this.prisma.knowledgeAtRiskSnapshot.findMany({
      where: { tenantId: args.tenantId },
      orderBy: { snapshotAt: 'desc' },
      take: 1_000,
      include: { soleExpert: { select: { name: true } } },
    });
    const latestByCategory = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByCategory.has(r.categoryName)) {
        latestByCategory.set(r.categoryName, r);
      }
    }
    const severityRank = (s: string): number =>
      s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
    const items = Array.from(latestByCategory.values())
      .sort(
        (a, b) =>
          severityRank(b.combinedSeverity) - severityRank(a.combinedSeverity),
      )
      .slice(0, Math.min(Math.max(args.limit ?? 50, 1), 200))
      .map((r) => ({
        categoryName: r.categoryName,
        soleExpertPersonId: r.soleExpertPersonId,
        soleExpertPersonName: r.soleExpert?.name ?? null,
        busFactorLevel: r.busFactorLevel,
        personRiskLevel: r.personRiskLevel,
        combinedSeverity: r.combinedSeverity,
        snapshotAt: r.snapshotAt.toISOString(),
      }));
    return { items };
  }

  // ──────────────────────────── helpers ───────────────────────────────

  /** Риск ухода носителя из riskFlagsJson + engagementScore. */
  private async resolvePersonRisk(args: {
    tenantId: string;
    personId: string;
  }): Promise<PersonRiskLevel> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, id: args.personId, deletedAt: null },
      select: { riskFlagsJson: true, engagementScore: true },
    });
    if (!person) return 'low';
    const flags = this.parseRiskFlags(person.riskFlagsJson);
    const engagementScore =
      person.engagementScore !== null
        ? Number(person.engagementScore)
        : null;
    return derivePersonRiskLevel({ riskFlags: flags, engagementScore });
  }

  /** Первый personId из `topExpertsJson.experts[]` (соло-эксперт). */
  private firstExpertPersonId(json: Prisma.JsonValue): string | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const experts = (json as { experts?: unknown }).experts;
    if (!Array.isArray(experts)) return null;
    for (const e of experts) {
      if (e && typeof e === 'object' && 'personId' in e) {
        const pid = (e as { personId?: unknown }).personId;
        if (typeof pid === 'string' && pid.length > 0) return pid;
      }
    }
    return null;
  }

  /** Разбор `Person.riskFlagsJson` → массив `{ severity }`. */
  private parseRiskFlags(
    json: Prisma.JsonValue,
  ): Array<{ severity?: string | null }> {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
    const flags = (json as { flags?: unknown }).flags;
    if (!Array.isArray(flags)) return [];
    const out: Array<{ severity?: string | null }> = [];
    for (const f of flags) {
      if (f && typeof f === 'object') {
        const sev = (f as { severity?: unknown }).severity;
        out.push({ severity: typeof sev === 'string' ? sev : null });
      }
    }
    return out;
  }
}
