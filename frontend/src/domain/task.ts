import type { TaskApi, TaskStatus } from "@/api/tasks.api";

export type TaskDomain = {
  id: string;
  meetingId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: string | null;
  dueDate: Date | null;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
  sourceQuote: string | null;
  confidence: number | null;
  createdManually: boolean;
  createdAt: Date;
  updatedAt: Date;
  extractorVersion: string | null;
};

export function taskFromApi(api: TaskApi): TaskDomain {
  return {
    id: api.id,
    meetingId: api.meetingId,
    title: api.title,
    description: api.description ?? null,
    status: api.status,
    assignee: api.assigneeRaw ?? null,
    dueDate: api.dueDate ? new Date(api.dueDate) : null,
    sourceStartMs:
      typeof api.sourceStartMs === "number" ? api.sourceStartMs : null,
    sourceEndMs: typeof api.sourceEndMs === "number" ? api.sourceEndMs : null,
    sourceQuote: api.sourceQuote ?? null,
    confidence: typeof api.confidence === "number" ? api.confidence : null,
    createdManually: api.createdManually,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    extractorVersion: api.extractorVersion ?? null,
  };
}

export function normTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/(?<=\d)[\s ]+(?=\d)/g, "")
    .replace(/[«»"'`.,;:!?()…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickPrimaryTasks(items: TaskDomain[]): TaskDomain[] {
  const norm = (t: TaskDomain) => normTaskTitle(t.title);
  const fast = items.filter((t) => t.extractorVersion === "fast");
  const seen = new Set(fast.map(norm));
  const rest = items.filter(
    (t) =>
      (t.extractorVersion === "v2" || t.extractorVersion === null) &&
      !seen.has(norm(t)),
  );
  return [...fast, ...rest];
}
