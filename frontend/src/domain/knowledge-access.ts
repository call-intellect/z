/**
 * DomainModel-слой доступа к знаниям через группы
 * (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть B — frontend).
 *
 * Маппит ApiDto (`@/api/knowledge-access.api`) в доменные модели для UI,
 * собирает направленную матрицу видимости отделов и держит русские подписи
 * видов групп. Все тексты — на русском (memory `feedback_admin_ui_russian_only`).
 */

import type {
  GroupMemberApi,
  KnowledgeGroupApi,
  VisibilityPolicyApi,
} from '@/api/knowledge-access.api';
import type { MeetingType } from '@/domain/enums';

// ─── Виды групп и закрытость ──────────────────────────────────────────────────

export type KnowledgeGroupKind =
  | 'department'
  | 'leadership'
  | 'council'
  | 'personal';

/** Русские подписи видов групп. */
export const GROUP_KIND_LABEL: Record<KnowledgeGroupKind, string> = {
  department: 'Отдел',
  leadership: 'Руководство',
  council: 'Совет',
  personal: 'Личное',
};

export type ClosedGroupKind = 'leadership' | 'council' | 'personal';

/** Варианты закрытости встречи для селектора (null = «нет, открыто»). */
export const CLOSED_GROUP_OPTIONS: Array<{
  value: ClosedGroupKind | 'none';
  label: string;
  hint: string;
}> = [
  {
    value: 'none',
    label: 'Открыто всем',
    hint: 'Знание встречи доступно всей компании (по умолчанию).',
  },
  {
    value: 'leadership',
    label: 'Только руководство',
    hint: 'Видят лишь участники группы «Руководство».',
  },
  {
    value: 'council',
    label: 'Только совет',
    hint: 'Видят лишь участники группы «Совет».',
  },
  {
    value: 'personal',
    label: 'Личное',
    hint: 'Видят лишь сам человек, HR и владелец.',
  },
];

// ─── Группа доступа (DomainModel) ─────────────────────────────────────────────

export interface KnowledgeGroupDomain {
  id: string;
  kind: KnowledgeGroupKind;
  kindLabel: string;
  name: string;
  isClosed: boolean;
  refId: string | null;
  memberCount: number;
}

export function toKnowledgeGroup(api: KnowledgeGroupApi): KnowledgeGroupDomain {
  const kind = (api.kind as KnowledgeGroupKind) ?? 'department';
  return {
    id: api.id,
    kind,
    kindLabel: GROUP_KIND_LABEL[kind] ?? api.kind,
    name: api.name,
    isClosed: api.isClosed,
    refId: api.refId,
    memberCount: api.memberCount,
  };
}

// ─── Член группы (DomainModel) ─────────────────────────────────────────────────

export interface GroupMemberDomain {
  personId: string;
  personName: string;
  /** true = добавлен вручную (override), false = из должности (auto). */
  isManual: boolean;
}

export function toGroupMember(api: GroupMemberApi): GroupMemberDomain {
  return {
    personId: api.personId,
    personName: api.personName || 'Без имени',
    isManual: api.source === 'manual',
  };
}

// ─── Направленная матрица видимости (UiModel) ──────────────────────────────────

/**
 * Для каждого отдела-субъекта — множество id видимых отделов.
 * Собирается из плоского списка политик `GroupVisibilityPolicy`.
 */
export type VisibilityMatrix = Map<string, Set<string>>;

export function buildVisibilityMatrix(
  policies: VisibilityPolicyApi[],
): VisibilityMatrix {
  const matrix: VisibilityMatrix = new Map();
  for (const p of policies) {
    const set = matrix.get(p.subjectGroupId) ?? new Set<string>();
    set.add(p.visibleGroupId);
    matrix.set(p.subjectGroupId, set);
  }
  return matrix;
}

// ─── Advisory-подсказка о конфиденциальности (клиентский эвристик) ──────────────

/**
 * «Чувствительные» типы встреч — для них стоит предложить закрыть доступ.
 * Это лишь подсказка (НЕ замок) — решает человек (В8 ТЗ).
 */
const SENSITIVE_MEETING_TYPES: ReadonlySet<MeetingType> = new Set([
  'interview',
]);

/** Слова-маркеры конфиденциальности в заголовке встречи (нижний регистр). */
const SENSITIVE_TITLE_MARKERS: readonly string[] = [
  'совет',
  'зарплат',
  'оклад',
  'увольн',
  'оценк',
  'аттестац',
  'конфиденц',
  'личн',
  'найм',
  'собеседован',
  'один на один',
  '1 на 1',
];

export interface ConfidentialityHint {
  /** Показывать ли подсказку. */
  show: boolean;
  /** Какую закрытость предложить проставить по кнопке. */
  suggested: ClosedGroupKind;
  /** Причина (для пояснения пользователю). */
  reason: string;
}

/**
 * Эвристика: похоже ли, что встреча конфиденциальная.
 * Срабатывает по типу встречи (например, «найм») ИЛИ по словам-маркерам в
 * заголовке. Найм/интервью → личное; «совет» в заголовке → совет; иначе →
 * руководство. Это подсказка — не блокирует и ничего не проставляет само.
 */
export function detectConfidentiality(
  meetingType: MeetingType,
  title: string,
): ConfidentialityHint {
  const lower = title.trim().toLowerCase();
  const byType = SENSITIVE_MEETING_TYPES.has(meetingType);
  const matched = SENSITIVE_TITLE_MARKERS.find((m) => lower.includes(m));

  if (!byType && !matched) {
    return { show: false, suggested: 'leadership', reason: '' };
  }

  if (byType || matched === 'найм' || matched === 'собеседован' || matched === 'личн') {
    return {
      show: true,
      suggested: 'personal',
      reason:
        'Похоже на встречу про конкретного человека (найм, оценка, личное). Знание лучше пометить как «Личное».',
    };
  }

  if (matched === 'совет') {
    return {
      show: true,
      suggested: 'council',
      reason: 'В названии есть слово «совет» — возможно, это закрытая встреча совета.',
    };
  }

  return {
    show: true,
    suggested: 'leadership',
    reason:
      'В названии есть слова, типичные для конфиденциальных встреч (зарплата, увольнение, оценка). Стоит закрыть доступ.',
  };
}
