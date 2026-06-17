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

@Injectable()
export class KnowledgeAtRiskService {
  private readonly logger = new Logger(KnowledgeAtRiskService.name);

  private static readonly SNAPSHOT_LOOKBACK_DAYS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async computeForTenant(args: { tenantId: string; now: Date }): Promise<{
    snapshots: number;
    atRisk: Array<{
      categoryName: string;
      soleExpertPersonId: string;
      combinedSeverity: SeverityLevel;
    }>;
  }> {
    const lookback = new Date(
      args.now.getTime() - KnowledgeAtRiskService.SNAPSHOT_LOOKBACK_DAYS * 86_400_000,
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

    const latestByCategory = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!latestByCategory.has(r.categoryName)) {
        latestByCategory.set(r.categoryName, r);
      }
    }
    if (latestByCategory.size === 0) {
      return { snapshots: 0, atRisk: [] };
    }

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
      const combinedSeverity = computeCombinedSeverity(busFactor, personRiskLevel);

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
    const severityRank = (s: string): number => (s === 'critical' ? 3 : s === 'warning' ? 2 : 1);
    const items = Array.from(latestByCategory.values())
      .sort((a, b) => severityRank(b.combinedSeverity) - severityRank(a.combinedSeverity))
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
    const engagementScore = person.engagementScore !== null ? Number(person.engagementScore) : null;
    return derivePersonRiskLevel({ riskFlags: flags, engagementScore });
  }

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

  private parseRiskFlags(json: Prisma.JsonValue): Array<{ severity?: string | null }> {
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
