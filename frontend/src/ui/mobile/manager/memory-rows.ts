import {
  DECISION_STATUS_LABEL,
  DECISION_STATUS_TONE,
  type DecisionListItem,
  type DecisionStatus,
} from "@/domain/decision";

export type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";

export function statusChipTone(status: DecisionStatus): ChipTone {
  switch (DECISION_STATUS_TONE[status]) {
    case "success":
      return "success";
    case "error":
      return "danger";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

export function statusLabel(status: DecisionStatus): string {
  return DECISION_STATUS_LABEL[status];
}

export function decidedDateLabel(item: DecisionListItem): string {
  const date = item.decidedAt ?? item.createdAt;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function sourceLabel(item: DecisionListItem): string {
  return item.decidedAt ? "Зафиксировано" : "В памяти с";
}

export interface MemoryCard {
  id: string;
  statement: string;
  statusLabel: string;
  statusTone: ChipTone;
  dateLabel: string;
  sourceLabel: string;
}

export function memoryCard(item: DecisionListItem): MemoryCard {
  return {
    id: item.id,
    statement: item.statement,
    statusLabel: statusLabel(item.status),
    statusTone: statusChipTone(item.status),
    dateLabel: decidedDateLabel(item),
    sourceLabel: sourceLabel(item),
  };
}

export function memoryCards(items: readonly DecisionListItem[]): MemoryCard[] {
  return items.map(memoryCard);
}
