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

import type { EntityLinkType } from '@prisma/client';

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

/**
 * Ф6 (2026-06-17) — атрибуция новой сущности при ingest.
 *
 * Признак «сущность НЕ привязана» (чистая часть — по in-memory полям entity):
 * у `metadata` нет ни одного явного ключа привязки к оргструктуре/клиенту.
 * Это переиспользуется и в эмиттере (block-ingest.worker), и в recheck —
 * чтобы условие было одним и тем же кодом, а не двумя расходящимися ветками.
 *
 * Почему именно metadata-ключи, а не граф: на МОМЕНТ создания (`created=true`)
 * у свежей Entity ещё НЕТ рёбер EntityLink (их строят async-воркеры позже) —
 * значит свежий customer/vendor по определению «не привязан». Эмиттер
 * проверяет дешёвую in-memory часть; recheck дополнительно смотрит, не
 * появилось ли ребро привязки к отделу/оргюниту/человеку/роли (см.
 * `attribution.unresolved_at_ingest` ниже) — тогда пробел закрыт.
 *
 * Список ключей консервативен: если LLM-экстрактор или ручная правка положили
 * любой из них — считаем сущность уже отнесённой и НЕ спрашиваем.
 */
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

/** Типы Entity, для которых атрибуционный вопрос имеет смысл (клиент/поставщик). */
export const ATTRIBUTION_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'customer',
  'vendor',
]);

/**
 * Чистая проверка «сущность не привязана» по типу + metadata (без БД).
 * `true` → значимый тип (customer/vendor) И нет явного ключа привязки.
 * Служебные типы (person/role/department/orgunit/event/…) → `false`.
 */
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

/** Типы рёбер EntityLink, означающие «сущность отнесена к оргструктуре/владельцу». */
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
  // ── Attribution (Ф6, contextCardKind='entity', contextCardId=Entity.id) ──
  // Пробел открыт, пока новая значимая сущность не привязана к отделу/клиенту/
  // владельцу. Закрыт (false), если: контекст не entity / нет id; сущность
  // удалена или слита (mergedIntoId); появился metadata-ключ привязки; либо
  // появилось ребро EntityLink к оргструктуре/владельцу.
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
    if (!entity) return false; // удалена → probe не нужен
    if (entity.mergedIntoId) return false; // слита в другую → пробел снят
    // metadata-привязка появилась (или тип перестал быть значимым) → закрыт.
    if (!isEntityUnattributed({ type: entity.type, metadata: entity.metadata }))
      return false;
    // Появилось ребро привязки к оргструктуре/владельцу → закрыт.
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
    return true; // всё ещё не привязана → пробел открыт
  },
};
