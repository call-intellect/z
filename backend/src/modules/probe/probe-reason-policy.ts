/**
 * Probe-система Фаза 2 (2026-06-11) — политика по типу пробела.
 *
 * Два статичных маппинга от машинного `reason`:
 *   - PROBE_REASON_WINDOW — окно полезности (immediate | deferrable).
 *     immediate = критичное/владелец/срок → спрашиваем сразу (минуя дайджест,
 *     Ф3). deferrable = факты/обзор/идеи/навыки → можно отложить в дайджест.
 *     Источник классификации — Ask-Early-Late-Right. Дефолт — `deferrable`.
 *   - PROBE_REASON_RECHECK — предикат «пробел ещё актуален?»: перечитывает
 *     исходную сущность по `contextCardId`. Возвращает `true`, если пробел
 *     ещё открыт (probe слать НАДО), `false` — если закрылся сам (Ф4
 *     подавит probe со status='suppressed_stale'). reason без записи в
 *     словаре recheck НЕ проверяется (= считается актуальным, слать).
 *
 * Это детерминированная ЛОГИКА (не крутилка) → код, не БД/AdminSetting
 * (решение Б5 ТЗ). Числовые пороги (касание-кап, час дайджеста) — AdminSetting.
 */

import type { PrismaService } from '../../common/prisma/prisma.service';

export type ProbeWindow = 'immediate' | 'deferrable';

/**
 * reason → окно. Только immediate-reason перечислены явно; всё прочее —
 * deferrable (дефолт `probeWindow`).
 */
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
};

/** Окно по reason с дефолтом `deferrable`. */
export function probeWindow(reason: string): ProbeWindow {
  return PROBE_REASON_WINDOW[reason] ?? 'deferrable';
}

/**
 * W2 autonomy (2026-06-12) — политика §9.2 ТЗ autonomy-remove-manual-confirmations:
 * напоминание-NUDGE, не вопрос — Кора и так знает, что нужно сделать; человека
 * не пингуем сразу, а собираем в ежедневный батч-дайджест
 * (`status='routed_to_digest'`, ProbeDigestCron подберёт). NUDGE-маршрут имеет
 * приоритет над окном PROBE_REASON_WINDOW (даже immediate-reason уходит дайджестом).
 *
 * `card.missing_deadline` — тоже NUDGE: сигнала для вывода дедлайна нет,
 * но это напоминание, а не пробел знания (decision.no_deadline_critical
 * остаётся immediate — критичный срок).
 */
export const NUDGE_REASONS: ReadonlySet<string> = new Set([
  'decision.overdue',
  'decision.outcome_unknown',
  'goal.kr_checkpoint_suggested',
  'commitment.followup',
  'commitment.silence_escalation',
  'goal_alignment_low',
  'card.missing_deadline',
]);

/** Контекст для recheck-предиката (передаётся диспетчером в Ф4). */
export interface ProbeRecheckCtx {
  prisma: PrismaService;
  tenantId: string;
  contextCardId: string | null;
  contextCardKind: string | null;
}

/**
 * Предикат «повод ещё актуален». `true` → слать (пробел открыт), `false` →
 * подавить (закрылся). При невозможности проверить (нет contextCardId) —
 * `true` (не подавляем). Если сущность удалена (не найдена) — `false`
 * (probe о несуществующем объекте не нужен).
 */
export type ProbeRecheckPredicate = (ctx: ProbeRecheckCtx) => Promise<boolean>;

export const PROBE_REASON_RECHECK: Record<string, ProbeRecheckPredicate> = {
  // ── Decision (contextCardKind='decision', contextCardId=Decision.id) ──
  'decision.missing_decider': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { decidedByPersonIds: true, decidedByPersonId: true },
    });
    if (!d) return false;
    // Пробел открыт, пока решающий не назначен.
    return d.decidedByPersonIds.length === 0 && !d.decidedByPersonId;
  },
  'decision.overdue': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { status: true },
    });
    if (!d) return false;
    // Закрылся, если решение исполнено/отменено.
    return d.status !== 'implemented' && d.status !== 'cancelled';
  },
  'decision.no_deadline_critical': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { deadline: true },
    });
    if (!d) return false;
    return d.deadline == null; // открыт, пока срока нет
  },
  'decision.outcome_unknown': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const d = await prisma.decision.findFirst({
      where: { id: contextCardId, tenantId },
      select: { actualOutcomes: true },
    });
    if (!d) return false;
    return d.actualOutcomes == null; // открыт, пока итог не записан
  },
  // ── Idea (contextCardKind='idea', contextCardId=Idea.id) ─────────────
  'idea.status_unclear': async ({ prisma, tenantId, contextCardId }) => {
    if (!contextCardId) return true;
    const idea = await prisma.idea.findFirst({
      where: { id: contextCardId, tenantId },
      select: { status: true, statusChangedAt: true },
    });
    if (!idea) return false;
    // Открыт, пока идея всё ещё «в обсуждении» и статус не менялся.
    return idea.status === 'in_discussion' && idea.statusChangedAt == null;
  },
  // ── Regulation/Process/Policy (kind ∈ {regulation,process,policy}) ───
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
