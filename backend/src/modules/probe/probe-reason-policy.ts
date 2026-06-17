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
  kr_checkpoint_suggested: 'immediate',
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

export interface ProbeRecheckCtx {
  prisma: PrismaService;
  tenantId: string;
  contextCardId: string | null;
  contextCardKind: string | null;
}

export type ProbeRecheckPredicate = (ctx: ProbeRecheckCtx) => Promise<boolean>;

export const PROBE_REASON_RECHECK: Record<string, ProbeRecheckPredicate> = {
  'decision.missing_decider': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { decidedByPersonIds: true, decidedByPersonId: true },
    });
    if (!d) return false;
    return d.decidedByPersonIds.length === 0 && !d.decidedByPersonId;
  },
  'decision.overdue': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { status: true },
    });
    if (!d) return false;
    return d.status !== 'implemented' && d.status !== 'cancelled';
  },
  'decision.no_deadline_critical': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { deadline: true },
    });
    if (!d) return false;
    return d.deadline == null;
  },
  'decision.outcome_unknown': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
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
  'regulation.missing_owner': async ({ prisma, tenantId, contextCardId, contextCardKind }) => {
    if (!contextCardId) return true;
    const kind = (contextCardKind ?? '').toLowerCase();
    if (kind === 'process') {
      const row = await prisma.process.findFirst({
        where: { id: contextCardId, tenantId },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    if (kind === 'policy') {
      const row = await prisma.policy.findFirst({
        where: { id: contextCardId, tenantId },
        select: { ownerPersonId: true },
      });
      if (!row) return false;
      return row.ownerPersonId == null;
    }
    const reg = await prisma.regulation.findFirst({
      where: { id: contextCardId, tenantId },
      select: { ownerPersonId: true },
    });
    if (!reg) return false;
    return reg.ownerPersonId == null;
  },
};
