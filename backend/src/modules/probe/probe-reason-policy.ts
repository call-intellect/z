import type { EntityLinkType } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';

export type ProbeWindow = 'immediate' | 'deferrable';

export const PROBE_REASON_WINDOW: Record<string, ProbeWindow> = {
  'decision.missing_decider': 'immediate',
  'decision.no_deadline_critical': 'immediate',
  'decision.overdue': 'immediate',
  'regulation.missing_owner': 'immediate',
  'temporal.fact_stale_contradiction.escalated': 'immediate',
  'commitment.silence_escalation': 'immediate',
  'consistency_violation.R1': 'immediate',
  'consistency_violation.R2': 'immediate',
  'consistency_violation.R3': 'immediate',
  'consistency_violation.R4': 'immediate',
  'consistency_violation.R5': 'immediate',
  'consistency_violation.R6': 'immediate',
  'goal.kr_checkpoint_suggested': 'immediate',
  'kr_checkpoint_suggested': 'immediate',
  'regulation.existence_confirm': 'deferrable',
};

export function probeWindow(reason: string): ProbeWindow {
  return PROBE_REASON_WINDOW[reason] ?? 'deferrable';
}

export const NUDGE_REASONS: ReadonlySet<string> = new Set([
  'decision.overdue',
  'decision.outcome_unknown',
  'goal.kr_checkpoint_suggested',
  'commitment.followup',
  'commitment.silence_escalation',
  'goal_alignment_low',
  'card.missing_deadline',
]);

export const MACHINE_FILLABLE_REASONS: ReadonlySet<string> = new Set([
  'regulation.missing_owner',
  'regulation.process_no_steps',
  'regulation.scope_unclear',
  'card.merge_suggestion',
  'experiment.no_owner',
  'process_template.missing_input_artifact',
  'process_template.missing_output_artifact',
  'process_template.step_without_owner',
]);

export type ProbeProvenance =
  | 'auto_unconfirmed'
  | 'confirmed_or_manual'
  | 'unknown';

export interface ProbeProvenanceCtx {
  prisma: PrismaService;
  tenantId: string;
  contextCardId: string | null;
  contextCardKind: string | null;
}

async function regulationFamilyProvenance(
  ctx: ProbeProvenanceCtx,
): Promise<ProbeProvenance> {
  const { prisma, tenantId, contextCardId, contextCardKind } = ctx;
  if (!contextCardId) return 'unknown';
  const kind = (contextCardKind ?? '').toLowerCase();
  const select = {
    sourceBlockIds: true,
    currentVersion: { select: { trustTier: true } },
  } as const;
  let card: {
    sourceBlockIds: string[];
    currentVersion: { trustTier: string } | null;
  } | null;
  if (kind === 'process') {
    card = await prisma.process.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select,
    });
  } else if (kind === 'policy') {
    card = await prisma.policy.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select,
    });
  } else {
    card = await prisma.regulation.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select,
    });
  }
  if (!card) return 'unknown';
  if (card.currentVersion?.trustTier === 'human') return 'confirmed_or_manual';
  const openCuration = await prisma.curationItem.findFirst({
    where: { tenantId, resourceId: contextCardId, status: 'pending' },
    select: { id: true },
  });
  if (openCuration) return 'auto_unconfirmed';
  if (card.sourceBlockIds.length > 0) return 'auto_unconfirmed';
  return 'unknown';
}

export async function resolveProbeProvenance(
  reason: string,
  ctx: ProbeProvenanceCtx,
): Promise<ProbeProvenance> {
  if (!ctx.contextCardId) return 'unknown';
  if (
    reason === 'regulation.missing_owner' ||
    reason === 'regulation.process_no_steps' ||
    reason === 'regulation.scope_unclear'
  ) {
    return regulationFamilyProvenance(ctx);
  }
  return 'unknown';
}

export interface ProbeRecheckCtx {
  prisma: PrismaService;
  tenantId: string;
  contextCardId: string | null;
  contextCardKind: string | null;
}

export type ProbeRecheckPredicate = (ctx: ProbeRecheckCtx) => Promise<boolean>;

const ATTRIBUTION_METADATA_KEYS: readonly string[] = [
  'departmentId',
  'department_id',
  'orgUnitId',
  'orgunit_id',
  'ownerPersonId',
  'ownerUserId',
  'owner_person_id',
  'clientId',
  'client_id',
  'customerId',
  'customer_id',
];

export const ATTRIBUTION_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'customer',
  'vendor',
]);

export function isEntityUnattributed(entity: {
  type: string;
  metadata?: unknown;
}): boolean {
  if (!ATTRIBUTION_ENTITY_TYPES.has(entity.type)) return false;
  const meta = entity.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const record = meta as Record<string, unknown>;
    for (const key of ATTRIBUTION_METADATA_KEYS) {
      const v = record[key];
      if (v !== undefined && v !== null && v !== '') return false;
    }
  }
  return true;
}

const ATTRIBUTION_LINK_TYPES: ReadonlyArray<EntityLinkType> = [
  'belongs_to',
  'part_of',
  'member_of',
  'works_at',
  'owned_by',
  'responsible_for',
  'accountable_for',
];

export const PROBE_REASON_RECHECK: Record<string, ProbeRecheckPredicate> = {
  'decision.missing_decider': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { decidedByPersonIds: true, decidedByPersonId: true },
    });
    if (!d) return false;
    return d.decidedByPersonIds.length === 0 && !d.decidedByPersonId;
  },
  'decision.overdue': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { status: true },
    });
    if (!d) return false;
    return d.status !== 'implemented' && d.status !== 'cancelled';
  },
  'decision.no_deadline_critical': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { deadline: true },
    });
    if (!d) return false;
    return d.deadline == null;
  },
  'decision.outcome_unknown': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { actualOutcomes: true },
    });
    if (!d) return false;
    return d.actualOutcomes == null;
  },
  'idea.status_unclear': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const idea = await prisma.idea.findFirst({
      where: { id: contextCardId, tenantId },
      select: { status: true, statusChangedAt: true },
    });
    if (!idea) return false;
    return idea.status === 'in_discussion' && idea.statusChangedAt == null;
  },
  'regulation.missing_owner': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    const kind = (contextCardKind ?? '').toLowerCase();
    if (kind === 'process') {
      const row = await prisma.process.findFirst({
        where: { id: contextCardId, tenantId, deletedAt: null },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    if (kind === 'policy') {
      const row = await prisma.policy.findFirst({
        where: { id: contextCardId, tenantId, deletedAt: null },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    const reg = await prisma.regulation.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { ownerPersonId: true },
    });
    if (!reg) return false;
    return reg.ownerPersonId == null;
  },
  'regulation.existence_confirm': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    const kind = (contextCardKind ?? '').toLowerCase();
    if (kind === 'process') {
      const row = await prisma.process.findFirst({
        where: { id: contextCardId, tenantId, deletedAt: null },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    if (kind === 'policy') {
      const row = await prisma.policy.findFirst({
        where: { id: contextCardId, tenantId, deletedAt: null },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    const reg = await prisma.regulation.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { ownerPersonId: true },
    });
    if (!reg) return false;
    return reg.ownerPersonId == null;
  },
  'attribution.unresolved_at_ingest': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    if (contextCardKind !== 'entity') return true;
    const entity = await prisma.entity.findFirst({
      where: { id: contextCardId, tenantId },
      select: { id: true, type: true, metadata: true, mergedIntoId: true },
    });
    if (!entity) return false;
    if (entity.mergedIntoId) return false;
    if (!isEntityUnattributed({ type: entity.type, metadata: entity.metadata }))
      return false;
    const link = await prisma.entityLink.findFirst({
      where: {
        tenantId,
        fromEntityId: contextCardId,
        relationType: { in: [...ATTRIBUTION_LINK_TYPES] },
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (link) return false;
    return true;
  },
};
