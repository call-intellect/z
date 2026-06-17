import type {
  GroupMemberApi,
  KnowledgeGroupApi,
  VisibilityPolicyApi,
} from "@/api/knowledge-access.api";
import type { MeetingType } from "@/domain/enums";

export type KnowledgeGroupKind =
  | "department"
  | "leadership"
  | "council"
  | "personal";

export const GROUP_KIND_LABEL: Record<KnowledgeGroupKind, string> = {
  department: "Отдел",
  leadership: "Руководство",
  council: "Совет",
  personal: "Личное",
};

export type ClosedGroupKind = "leadership" | "council" | "personal";

export const CLOSED_GROUP_OPTIONS: Array<{
  value: ClosedGroupKind | "none";
  label: string;
  hint: string;
}> = [
  {
    value: "none",
    label: "Открыто всем",
    hint: "Знание встречи доступно всей компании (по умолчанию).",
  },
  {
    value: "leadership",
    label: "Только руководство",
    hint: "Видят лишь участники группы «Руководство».",
  },
  {
    value: "council",
    label: "Только совет",
    hint: "Видят лишь участники группы «Совет».",
  },
  {
    value: "personal",
    label: "Личное",
    hint: "Видят лишь сам человек, HR и владелец.",
  },
];

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
  const kind = (api.kind as KnowledgeGroupKind) ?? "department";
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

export interface GroupMemberDomain {
  personId: string;
  personName: string;
  isManual: boolean;
}

export function toGroupMember(api: GroupMemberApi): GroupMemberDomain {
  return {
    personId: api.personId,
    personName: api.personName || "Без имени",
    isManual: api.source === "manual",
  };
}

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

const SENSITIVE_MEETING_TYPES: ReadonlySet<MeetingType> = new Set([
  "interview",
]);

const SENSITIVE_TITLE_MARKERS: readonly string[] = [
  "совет",
  "зарплат",
  "оклад",
  "увольн",
  "оценк",
  "аттестац",
  "конфиденц",
  "личн",
  "найм",
  "собеседован",
  "один на один",
  "1 на 1",
];

export interface ConfidentialityHint {
  show: boolean;
  suggested: ClosedGroupKind;
  reason: string;
}

export function detectConfidentiality(
  meetingType: MeetingType,
  title: string,
): ConfidentialityHint {
  const lower = title.trim().toLowerCase();
  const byType = SENSITIVE_MEETING_TYPES.has(meetingType);
  const matched = SENSITIVE_TITLE_MARKERS.find((m) => lower.includes(m));

  if (!byType && !matched) {
    return { show: false, suggested: "leadership", reason: "" };
  }

  if (
    byType ||
    matched === "найм" ||
    matched === "собеседован" ||
    matched === "личн"
  ) {
    return {
      show: true,
      suggested: "personal",
      reason:
        "Похоже на встречу про конкретного человека (найм, оценка, личное). Знание лучше пометить как «Личное».",
    };
  }

  if (matched === "совет") {
    return {
      show: true,
      suggested: "council",
      reason:
        "В названии есть слово «совет» — возможно, это закрытая встреча совета.",
    };
  }

  return {
    show: true,
    suggested: "leadership",
    reason:
      "В названии есть слова, типичные для конфиденциальных встреч (зарплата, увольнение, оценка). Стоит закрыть доступ.",
  };
}
