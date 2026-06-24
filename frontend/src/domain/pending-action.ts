import type {
  PendingActionDetailApi,
  PendingActionItemApi,
  PendingActionSeverityApi,
  PendingActionSourceApi,
  PendingActionsCountApi,
} from "@/api/pending-actions.api";

export type PendingActionSource = PendingActionSourceApi;
export type PendingActionSeverity = PendingActionSeverityApi;

export interface PendingActionCite {
  meetingTitle?: string;
  timecode?: string;
  url?: string;
}

export interface ConflictVersion {
  text: string;
  date?: string;
  cite?: PendingActionCite;
}

export type PendingActionDetail =
  | {
      kind: "probe";
      question: string;
      context?: string;
      meetingTitle?: string;
      cite?: PendingActionCite;
      notificationId: string;
      draftAnswer?: string;
      draftKind?: string;
    }
  | {
      kind: "conflict";
      summary: string;
      oldVersion: ConflictVersion;
      newVersion: ConflictVersion;
    }
  | {
      kind: "intake";
      title: string;
      description?: string;
      assigneeName?: string;
      dueLabel?: string;
      confidencePct?: number;
      cite?: PendingActionCite;
    }
  | {
      kind: "curation";
      cardTitle: string;
      preview?: string;
      cite?: PendingActionCite;
    }
  | {
      kind: "task_closure";
      taskTitle: string;
      rationale?: string;
      evidenceQuote?: string;
      confidencePct?: number;
    }
  | {
      kind: "task_review";
      taskTitle: string;
      reason?: string;
    }
  | {
      kind: "progress_draft";
      taskTitle: string;
      health: string;
      preview?: string;
      evidenceQuote?: string;
      confidencePct?: number;
    };

export interface PendingAction {
  source: PendingActionSource;
  resourceType: string;
  resourceId: string;
  title: string;
  severity: PendingActionSeverity;
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
  sourceLabel: string;
  detail?: PendingActionDetail;
}

export interface PendingActionsCount {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

export const PENDING_SOURCE_LABEL: Record<PendingActionSource, string> = {
  curation: "Карточка знания",
  conflict: "Конфликт",
  intake: "Задача из встречи",
  probe: "Вопрос Коры",
  task_closure: "Задача к закрытию",
  task_review: "Задача под вопросом",
  progress_draft: "Черновик прогресса",
};

export type PendingChipVariant = "info" | "danger" | "lavender" | "sand";

export const PENDING_SOURCE_CHIP: Record<
  PendingActionSource,
  PendingChipVariant
> = {
  curation: "info",
  conflict: "danger",
  intake: "lavender",
  probe: "sand",
  task_closure: "info",
  task_review: "sand",
  progress_draft: "lavender",
};

export function pendingSeverityToneClass(
  severity: PendingActionSeverity,
): string {
  return severity === "urgent"
    ? "bg-danger/15 text-danger border-danger/30"
    : "bg-accent-muted text-accent border-accent-border";
}

export function pendingSeverityBadgeVariant(
  severity: PendingActionSeverity,
): "danger" | "secondary" {
  return severity === "urgent" ? "danger" : "secondary";
}

export function samePendingAction(
  a: { source: PendingActionSource; resourceId: string },
  b: { source: PendingActionSource; resourceId: string },
): boolean {
  return a.source === b.source && a.resourceId === b.resourceId;
}

export function formatPendingAge(ageDays: number): string {
  const d = Math.max(0, Math.round(ageDays));
  if (d === 0) return "сегодня";
  return `${d} дн.`;
}

export function formatPendingWait(ageDays: number): string {
  const d = Math.max(0, Math.round(ageDays));
  return d === 0 ? "ждёт сегодня" : `ждёт ${d} дн.`;
}

export function formatPendingPriority(severity: PendingActionSeverity): string {
  return severity === "urgent" ? "высокий приоритет" : "средний приоритет";
}

export function formatPendingCite(cite?: PendingActionCite): string | null {
  if (!cite) return null;
  const parts: string[] = [];
  if (cite.meetingTitle) parts.push(`встреча ${cite.meetingTitle}`);
  if (cite.timecode) parts.push(`[${cite.timecode}]`);
  const text = parts.join(" ").trim();
  return text.length > 0 ? text : null;
}

function normalizeConfidencePct(raw?: number): number | undefined {
  if (raw == null || Number.isNaN(raw)) return undefined;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function mapCite(
  cite?: PendingActionCite | undefined,
): PendingActionCite | undefined {
  if (!cite) return undefined;
  return {
    meetingTitle: cite.meetingTitle,
    timecode: cite.timecode,
    url: cite.url,
  };
}

export function mapPendingActionDetail(
  api: PendingActionDetailApi | undefined,
): PendingActionDetail | undefined {
  if (!api) return undefined;
  switch (api.kind) {
    case "probe":
      return {
        kind: "probe",
        question: api.question,
        context: api.context,
        meetingTitle: api.meetingTitle,
        cite: mapCite(api.cite),
        notificationId: api.notificationId,
        draftAnswer: api.draftAnswer,
        draftKind: api.draftKind,
      };
    case "conflict":
      return {
        kind: "conflict",
        summary: api.summary,
        oldVersion: {
          text: api.oldVersion.text,
          date: api.oldVersion.date,
          cite: mapCite(api.oldVersion.cite),
        },
        newVersion: {
          text: api.newVersion.text,
          date: api.newVersion.date,
          cite: mapCite(api.newVersion.cite),
        },
      };
    case "intake":
      return {
        kind: "intake",
        title: api.title,
        description: api.description,
        assigneeName: api.assigneeName,
        dueLabel: api.dueLabel,
        confidencePct: normalizeConfidencePct(api.confidence),
        cite: mapCite(api.cite),
      };
    case "curation":
      return {
        kind: "curation",
        cardTitle: api.cardTitle,
        preview: api.preview,
        cite: mapCite(api.cite),
      };
    case "task_closure":
      return {
        kind: "task_closure",
        taskTitle: api.taskTitle,
        rationale: api.rationale,
        evidenceQuote: api.evidenceQuote,
        confidencePct: normalizeConfidencePct(api.confidence),
      };
    case "task_review":
      return {
        kind: "task_review",
        taskTitle: api.taskTitle,
        reason: api.reason,
      };
    case "progress_draft":
      return {
        kind: "progress_draft",
        taskTitle: api.taskTitle,
        health: api.health,
        preview: api.preview,
        evidenceQuote: api.evidenceQuote,
        confidencePct: normalizeConfidencePct(api.confidence),
      };
    default:
      return undefined;
  }
}

export function mapPendingAction(api: PendingActionItemApi): PendingAction {
  return {
    source: api.source,
    resourceType: api.resourceType,
    resourceId: api.resourceId,
    title: api.title,
    severity: api.severity,
    ageDays: api.ageDays,
    actionUrl: api.actionUrl,
    canQuickConfirm: api.canQuickConfirm,
    sourceLabel: PENDING_SOURCE_LABEL[api.source] ?? api.source,
    detail: mapPendingActionDetail(api.detail),
  };
}

export function mapPendingActionsCount(
  api: PendingActionsCountApi,
): PendingActionsCount {
  return {
    total: api.total,
    bySource: {
      curation: api.bySource?.curation ?? 0,
      conflict: api.bySource?.conflict ?? 0,
      intake: api.bySource?.intake ?? 0,
      probe: api.bySource?.probe ?? 0,
    },
  };
}
