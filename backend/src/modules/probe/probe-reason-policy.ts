import type { EntityLinkType } from '@prisma/client';

import type { PrismaService } from '../../common/prisma/prisma.service';

export type ProbeWindow = 'immediate' | 'deferrable';

export const PROBE_REASON_WINDOW: Record<string, ProbeWindow> = {
  'temporal.fact_stale_contradiction.escalated': 'immediate',
  'goal.kr_checkpoint_suggested': 'immediate',
  'kr_checkpoint_suggested': 'immediate',
  'task.assignee_unresolved': 'immediate',
  'task.due_date_missing': 'immediate',
  'task.poorly_specified': 'immediate',
  'task.false_positive': 'immediate',
  'task.completion_detail_missing': 'immediate',
  'task.method_capture': 'immediate',
};

export function probeWindow(reason: string): ProbeWindow {
  return PROBE_REASON_WINDOW[reason] ?? 'deferrable';
}

export const NUDGE_REASONS: ReadonlySet<string> = new Set([
  'goal.kr_checkpoint_suggested',
  'goal_alignment_low',
  'card.missing_deadline',
]);

export const MACHINE_FILLABLE_REASONS: ReadonlySet<string> = new Set([
  'card.merge_suggestion',
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

export async function resolveProbeProvenance(
  _reason: string,
  _ctx: ProbeProvenanceCtx,
): Promise<ProbeProvenance> {
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
  'task.assignee_unresolved': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    if (contextCardKind === 'intake_issue') {
      const intake = await prisma.intakeIssue.findFirst({
        where: { id: contextCardId, tenantId },
        select: { suggestedAssigneeId: true, status: true },
      });
      if (!intake) return false;
      return intake.suggestedAssigneeId == null && intake.status === 'pending';
    }
    const issue = await prisma.issue.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { assignees: { select: { id: true } } },
    });
    if (!issue) return false;
    return issue.assignees.length === 0;
  },
  'task.due_date_missing': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    if (contextCardKind === 'intake_issue') {
      const intake = await prisma.intakeIssue.findFirst({
        where: { id: contextCardId, tenantId },
        select: { suggestedDueDate: true, status: true },
      });
      if (!intake) return false;
      return intake.suggestedDueDate == null && intake.status === 'pending';
    }
    const issue = await prisma.issue.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { dueDate: true },
    });
    if (!issue) return false;
    return issue.dueDate == null;
  },
  'task.poorly_specified': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    if (contextCardKind === 'intake_issue') {
      const intake = await prisma.intakeIssue.findFirst({
        where: { id: contextCardId, tenantId },
        select: { extractedDescription: true, status: true },
      });
      if (!intake) return false;
      const description = (intake.extractedDescription ?? '').trim();
      return intake.status === 'pending' && description.length < 12;
    }
    const issue = await prisma.issue.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return Boolean(issue);
  },
  'task.false_positive': async ({
    prisma,
    tenantId,
    contextCardId,
    contextCardKind,
  }) => {
    if (!contextCardId) return true;
    if (contextCardKind === 'intake_issue') {
      const intake = await prisma.intakeIssue.findFirst({
        where: { id: contextCardId, tenantId },
        select: { status: true },
      });
      if (!intake) return false;
      return intake.status === 'pending';
    }
    const issue = await prisma.issue.findFirst({
      where: { id: contextCardId, tenantId, deletedAt: null },
      select: { id: true },
    });
    return Boolean(issue);
  },
};
