import { Inject, Injectable } from '@nestjs/common';
import type { ThemeBranch } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { THEME_BRANCH_VALUES } from './theme-classification.service';

export type BranchSignal = 'green' | 'yellow' | 'red';

const UNASSIGNED = 'unassigned' as const;

export type BranchBucketKey = ThemeBranch | typeof UNASSIGNED;

export interface BranchMapEntry {
  branch: string;
  counts: {
    themes: number;
    regulations: number;
    processes: number;
    documents: number;
    decisions: number;
  };
  signal: BranchSignal;
}

export function computeBranchSignal(
  themes: Array<{ dynamic: 'growing' | 'stable' | 'declining' }>,
): BranchSignal {
  if (themes.length === 0) return 'green';
  if (themes.some((t) => t.dynamic === 'declining')) return 'red';
  if (themes.every((t) => t.dynamic === 'growing')) return 'green';
  return 'yellow';
}

@Injectable()
export class BranchDerivationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async deriveBranchForEntityIds(
    tenantId: string,
    entityIds: string[],
    viewerUserId: string,
  ): Promise<Map<string, ThemeBranch | null>> {
    const result = new Map<string, ThemeBranch | null>();
    if (entityIds.length === 0) return result;

    const rows = await this.prisma.themeEntity.findMany({
      where: {
        tenantId,
        entityId: { in: entityIds },
        theme: {
          branch: { not: null },
          status: 'active',
          OR: [{ visibility: 'team' }, { createdByUserId: viewerUserId }],
        },
      },
      select: {
        entityId: true,
        theme: { select: { branch: true, weight: true } },
      },
    });

    const best = new Map<string, { branch: ThemeBranch; weight: number }>();
    for (const row of rows) {
      const branch = row.theme.branch;
      if (branch == null) continue;
      const weight = Number(row.theme.weight);
      const current = best.get(row.entityId);
      if (current == null || weight > current.weight) {
        best.set(row.entityId, { branch, weight });
      }
    }

    for (const [entityId, { branch }] of best) {
      result.set(entityId, branch);
    }
    return result;
  }

  async deriveBranchForThemeIds(
    tenantId: string,
    themeIds: string[],
    viewerUserId: string,
  ): Promise<Map<string, ThemeBranch | null>> {
    const result = new Map<string, ThemeBranch | null>();
    if (themeIds.length === 0) return result;

    const themes = await this.prisma.theme.findMany({
      where: {
        id: { in: themeIds },
        tenantId,
        status: 'active',
        OR: [{ visibility: 'team' }, { createdByUserId: viewerUserId }],
      },
      select: { id: true, branch: true },
    });

    for (const theme of themes) {
      result.set(theme.id, theme.branch);
    }
    return result;
  }

  async aggregateBranchMap(tenantId: string, viewerUserId: string): Promise<BranchMapEntry[]> {
    const themeVisibility = {
      OR: [{ visibility: 'team' as const }, { createdByUserId: viewerUserId }],
    };

    const buckets = new Map<BranchBucketKey, BranchMapEntry>();
    const dynamicsByBranch = new Map<
      BranchBucketKey,
      Array<{ dynamic: 'growing' | 'stable' | 'declining' }>
    >();

    const ensure = (key: BranchBucketKey): BranchMapEntry => {
      let entry = buckets.get(key);
      if (entry == null) {
        entry = {
          branch: key,
          counts: { themes: 0, regulations: 0, processes: 0, documents: 0, decisions: 0 },
          signal: 'green',
        };
        buckets.set(key, entry);
      }
      return entry;
    };

    const themes = await this.prisma.theme.findMany({
      where: { tenantId, status: 'active', ...themeVisibility },
      select: { branch: true, dynamic: true },
    });
    for (const theme of themes) {
      const key: BranchBucketKey = theme.branch ?? UNASSIGNED;
      ensure(key).counts.themes += 1;
      const list = dynamicsByBranch.get(key) ?? [];
      list.push({ dynamic: theme.dynamic });
      dynamicsByBranch.set(key, list);
    }

    const regulations = await this.prisma.regulation.findMany({
      where: { tenantId, entityId: { not: null } },
      select: { entityId: true },
    });
    const regulationEntityIds = regulations
      .map((r) => r.entityId)
      .filter((id): id is string => id != null);
    const regulationBranches = await this.deriveBranchForEntityIds(
      tenantId,
      regulationEntityIds,
      viewerUserId,
    );
    for (const r of regulations) {
      const branch = r.entityId != null ? regulationBranches.get(r.entityId) ?? null : null;
      ensure(branch ?? UNASSIGNED).counts.regulations += 1;
    }

    const processes = await this.prisma.process.findMany({
      where: { tenantId, entityId: { not: null } },
      select: { entityId: true },
    });
    const processEntityIds = processes
      .map((p) => p.entityId)
      .filter((id): id is string => id != null);
    const processBranches = await this.deriveBranchForEntityIds(
      tenantId,
      processEntityIds,
      viewerUserId,
    );
    for (const p of processes) {
      const branch = p.entityId != null ? processBranches.get(p.entityId) ?? null : null;
      ensure(branch ?? UNASSIGNED).counts.processes += 1;
    }

    const decisions = await this.prisma.decision.findMany({
      where: { tenantId },
      select: { entityId: true, affectsEntityIds: true },
    });
    const decisionEntityIds = new Set<string>();
    for (const d of decisions) {
      if (d.entityId != null) decisionEntityIds.add(d.entityId);
      for (const id of d.affectsEntityIds) decisionEntityIds.add(id);
    }
    const decisionBranches = await this.deriveBranchForEntityIds(
      tenantId,
      [...decisionEntityIds],
      viewerUserId,
    );
    for (const d of decisions) {
      let branch: ThemeBranch | null =
        d.entityId != null ? decisionBranches.get(d.entityId) ?? null : null;
      if (branch == null) {
        for (const id of d.affectsEntityIds) {
          const candidate = decisionBranches.get(id) ?? null;
          if (candidate != null) {
            branch = candidate;
            break;
          }
        }
      }
      ensure(branch ?? UNASSIGNED).counts.decisions += 1;
    }

    const documents = await this.prisma.document.findMany({
      where: { tenantId, attachedThemeId: { not: null } },
      select: { attachedThemeId: true },
    });
    const documentThemeIds = documents
      .map((d) => d.attachedThemeId)
      .filter((id): id is string => id != null);
    const documentBranches = await this.deriveBranchForThemeIds(
      tenantId,
      documentThemeIds,
      viewerUserId,
    );
    for (const d of documents) {
      const branch =
        d.attachedThemeId != null ? documentBranches.get(d.attachedThemeId) ?? null : null;
      ensure(branch ?? UNASSIGNED).counts.documents += 1;
    }

    const ordered: BranchMapEntry[] = [];
    for (const branch of THEME_BRANCH_VALUES) {
      const entry = ensure(branch);
      entry.signal = computeBranchSignal(dynamicsByBranch.get(branch) ?? []);
      ordered.push(entry);
    }

    const unassigned = buckets.get(UNASSIGNED);
    if (unassigned != null) {
      const c = unassigned.counts;
      const hasAny =
        c.themes > 0 || c.regulations > 0 || c.processes > 0 || c.documents > 0 || c.decisions > 0;
      if (hasAny) {
        unassigned.signal = computeBranchSignal(dynamicsByBranch.get(UNASSIGNED) ?? []);
        ordered.push(unassigned);
      }
    }

    return ordered;
  }
}
