import type {
  TaskSolutionDetailApi,
  TaskSolutionListItemApi,
  TaskSolutionSourceItemApi,
  TaskSolutionSourcesApi,
  TaskSolutionStatusApi,
  TaskSolutionSummaryApi,
  TaskSolutionVersionItemApi,
} from "@/api/task-solutions.api";
import {
  mapPreviewToProvenanceRef,
  type ProvenanceRef,
} from "@/domain/provenance";

export type TaskSolutionStatus = TaskSolutionStatusApi;

export const TASK_SOLUTION_STATUS_LABEL: Record<TaskSolutionStatus, string> = {
  active: "Действует",
  deprecated: "Устарел",
  archived: "В архиве",
};

export interface TaskSolutionListItem {
  id: string;
  title: string;
  taskDescription: string;
  ownerPersonId: string;
  ownerName: string | null;
  skillTags: string[];
  status: TaskSolutionStatus;
  sourceIssueId: string;
  repeatGroupKey: string | null;
  repeatGroupSize: number;
  candidateInstruction: boolean;
  promotedToInstructionId: string | null;
  provenancePreview?: ProvenanceRef | null;
  lastConfirmedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  issueDeepLink: string;
}

export interface TaskSolutionDetail extends TaskSolutionListItem {
  solutionMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  version: number;
  dataClass: string;
  sourceIssueIdentifier: string | null;
  sourceIssueTitle: string | null;
}

export interface TaskSolutionSource {
  blockId: string;
  quote: string;
  startMs: number | null;
  meeting: { id: string; title: string; date: Date } | null;
  deepLink: string | null;
}

export interface TaskSolutionVersionItem {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface TaskSolutionSummary {
  total: number;
  candidates: number;
  weekDelta: number;
}

export function mapTaskSolutionListItem(
  api: TaskSolutionListItemApi,
): TaskSolutionListItem {
  return {
    id: api.id,
    title: api.title,
    taskDescription: api.taskDescription,
    ownerPersonId: api.ownerPersonId,
    ownerName: api.ownerName,
    skillTags: api.skillTags ?? [],
    status: api.status,
    sourceIssueId: api.sourceIssueId,
    repeatGroupKey: api.repeatGroupKey,
    repeatGroupSize: api.repeatGroupSize,
    candidateInstruction: api.candidateInstruction,
    promotedToInstructionId: api.promotedToInstructionId,
    provenancePreview: mapPreviewToProvenanceRef(
      api.previewQuote,
      api.previewSourceRef,
    ),
    lastConfirmedAt: api.lastConfirmedAt ? new Date(api.lastConfirmedAt) : null,
    updatedAt: new Date(api.updatedAt),
    createdAt: new Date(api.createdAt),
    issueDeepLink: `/issues/${encodeURIComponent(api.sourceIssueId)}`,
  };
}

export function mapTaskSolutionDetail(
  api: TaskSolutionDetailApi,
): TaskSolutionDetail {
  return {
    ...mapTaskSolutionListItem(api),
    solutionMd: api.solutionMd,
    sourceBlockIds: api.sourceBlockIds,
    personSubjectIds: api.personSubjectIds,
    currentVersionId: api.currentVersionId,
    version: api.version,
    dataClass: api.dataClass,
    sourceIssueIdentifier: api.sourceIssueIdentifier,
    sourceIssueTitle: api.sourceIssueTitle,
  };
}

export function mapTaskSolutionSource(
  api: TaskSolutionSourceItemApi,
): TaskSolutionSource {
  const startMs = api.startMs ?? null;
  const meeting = api.meeting
    ? {
        id: api.meeting.id,
        title: api.meeting.title,
        date: new Date(api.meeting.date),
      }
    : null;
  return {
    blockId: api.blockId,
    quote: api.quote,
    startMs,
    meeting,
    deepLink: meeting
      ? `/meetings/${meeting.id}?t=${Math.max(0, Math.round((startMs ?? 0) / 1000))}`
      : null,
  };
}

export function mapTaskSolutionSources(
  api: TaskSolutionSourcesApi,
): TaskSolutionSource[] {
  return api.items.map(mapTaskSolutionSource);
}

export function mapTaskSolutionVersion(
  api: TaskSolutionVersionItemApi,
): TaskSolutionVersionItem {
  return {
    id: api.id,
    version: api.version,
    previousVersionId: api.previousVersionId,
    payload: api.payload,
    changeReason: api.changeReason,
    createdAt: new Date(api.createdAt),
    createdByUserId: api.createdByUserId,
  };
}

export function mapTaskSolutionSummary(
  api: TaskSolutionSummaryApi,
): TaskSolutionSummary {
  return {
    total: api.total ?? 0,
    candidates: api.candidates ?? 0,
    weekDelta: api.weekDelta ?? 0,
  };
}

export function isInstructionCandidate(item: TaskSolutionListItem): boolean {
  return (
    item.candidateInstruction &&
    item.promotedToInstructionId == null &&
    item.repeatGroupSize >= 2
  );
}
