import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IdeaClusterDto } from '../../ideas/dto/ideas.dto';
import type {
  InsightCauseCategoryDto,
  InsightDynamicDto,
  InsightKindDto,
  InsightListItemDto,
  InsightSeverityDto,
  InsightStatusDto,
} from '../../insights/dto/insights.dto';
import type {
  OperationsDashboardBlockerDto,
  OperationsDashboardTeamFrictionDto,
} from '../dto/operations-dashboard.dto';

import type { OperationsDashboardService } from './operations-dashboard.service';

export interface WindowSignals {
  risksByCause: InsightListItemDto[];
  ideaClusters: IdeaClusterDto[];
  teamFrictions: OperationsDashboardTeamFrictionDto[];
  blockers: OperationsDashboardBlockerDto[];
}

interface InsightRow {
  id: string;
  kind: string;
  statement: string;
  severity: string;
  status: string;
  dynamicLabel: string;
  frequencyScore: unknown;
  dynamicScore: unknown;
  affectedEntityIds: string[];
  relatedDecisionIds: string[];
  causeCategory: string | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  sourceBlockIds: string[];
  confidence: unknown;
  updatedAt: Date;
  createdAt: Date;
}

interface ClusterRow {
  id: string;
  name: string;
  description: string | null;
  ideaIds: string[];
  clusterWeight: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function computeTeamFrictionClamp(
  frictions: Array<{ confidence: number }>,
  minConfidence: number,
  repeatCount: number,
): { warn: boolean; risk: boolean } {
  const qualifying = frictions.filter((f) => (f.confidence ?? 0) >= minConfidence).length;
  return { warn: qualifying >= 1, risk: qualifying >= repeatCount };
}

function mapInsightToListItem(ins: InsightRow): InsightListItemDto {
  return {
    id: ins.id,
    kind: ins.kind as InsightKindDto,
    statement: ins.statement,
    severity: ins.severity as InsightSeverityDto,
    status: ins.status as InsightStatusDto,
    dynamicLabel: ins.dynamicLabel as InsightDynamicDto,
    frequencyScore: Number(ins.frequencyScore),
    dynamicScore: Number(ins.dynamicScore),
    affectedEntityIds: ins.affectedEntityIds,
    relatedDecisionIds: ins.relatedDecisionIds,
    causeCategory: (ins.causeCategory as InsightCauseCategoryDto) ?? null,
    firstObservedAt: ins.firstObservedAt.toISOString(),
    lastObservedAt: ins.lastObservedAt.toISOString(),
    sourceBlocksCount: ins.sourceBlockIds.length,
    confidence: Number(ins.confidence),
    updatedAt: ins.updatedAt.toISOString(),
    createdAt: ins.createdAt.toISOString(),
  };
}

function mapClusterToDto(c: ClusterRow): IdeaClusterDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    ideaIds: c.ideaIds,
    clusterWeight: Number(c.clusterWeight),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function collectWindowSignals(args: {
  prisma: PrismaService;
  opsDashboard: OperationsDashboardService;
  tenantId: string;
  from: string;
  to: string;
}): Promise<WindowSignals> {
  const fromUtc = new Date(`${args.from}T00:00:00.000Z`);
  const toUtc = new Date(`${args.to}T23:59:59.999Z`);

  const [insightRows, clusterRows, frictions, blockers] = await Promise.all([
    args.prisma.insight.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: ['active', 'mitigating'] },
        lastObservedAt: { gte: fromUtc, lte: toUtc },
      },
      orderBy: [
        { dynamicScore: 'desc' },
        { frequencyScore: 'desc' },
        { lastObservedAt: 'desc' },
      ],
      take: 20,
      select: {
        id: true,
        kind: true,
        statement: true,
        severity: true,
        status: true,
        dynamicLabel: true,
        frequencyScore: true,
        dynamicScore: true,
        affectedEntityIds: true,
        relatedDecisionIds: true,
        causeCategory: true,
        firstObservedAt: true,
        lastObservedAt: true,
        sourceBlockIds: true,
        confidence: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
    args.prisma.ideaCluster.findMany({
      where: {
        tenantId: args.tenantId,
        updatedAt: { gte: fromUtc, lte: toUtc },
      },
      orderBy: { clusterWeight: 'desc' },
      take: 12,
      select: {
        id: true,
        name: true,
        description: true,
        ideaIds: true,
        clusterWeight: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    args.opsDashboard.getTeamFrictions({
      tenantId: args.tenantId,
      since: fromUtc,
      to: toUtc,
      limit: 12,
    }),
    args.opsDashboard.getBlockers({
      tenantId: args.tenantId,
      window: { from: args.from, to: args.to },
      limit: 20,
    }),
  ]);

  return {
    risksByCause: (insightRows ?? []).map((ins) => mapInsightToListItem(ins as InsightRow)),
    ideaClusters: (clusterRows ?? []).map((c) => mapClusterToDto(c as ClusterRow)),
    teamFrictions: frictions.items ?? [],
    blockers: blockers.items ?? [],
  };
}
