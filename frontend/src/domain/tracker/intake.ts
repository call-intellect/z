/**
 * Доменная модель intake-карточки (входящая задача перед триажем).
 *
 * Контракт: `backend/src/modules/tracker/services/intake.service.ts`.
 */

import {
  parseIssuePriority,
  type IntakeSource,
  type IntakeStatus,
  type IssuePriority,
} from './enums';

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface IntakeApi {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: string;
  source: string;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  suggestedProjectName: string | null;
  suggestedAssigneeName: string | null;
  suggestedGoalTitle: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: string | null;
  suggestedLabels: string[];
  confidence: string | null;
  triagedByUserId: string | null;
  triagedAt: string | null;
  rejectedReason: string | null;
  snoozedUntil: string | null;
  createdIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListIntakeResponseApi {
  items: IntakeApi[];
  total: number;
  page: number;
  limit: number;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Intake {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: IntakeStatus;
  source: IntakeSource;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  suggestedProjectName: string | null;
  suggestedAssigneeName: string | null;
  suggestedGoalTitle: string | null;
  suggestedPriority: IssuePriority | null;
  suggestedDueDate: Date | null;
  suggestedLabels: string[];
  confidence: number | null;
  triagedByUserId: string | null;
  triagedAt: Date | null;
  rejectedReason: string | null;
  snoozedUntil: Date | null;
  createdIssueId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const KNOWN_STATUSES = new Set<IntakeStatus>([
  'pending',
  'snoozed',
  'accepted',
  'rejected',
  'duplicate',
]);

const KNOWN_SOURCES = new Set<IntakeSource>([
  'in_app',
  'email',
  'telegram',
  'checkin',
  'meeting',
  'api',
  'concierge',
]);

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

const parseStatus = (raw: string): IntakeStatus =>
  KNOWN_STATUSES.has(raw as IntakeStatus) ? (raw as IntakeStatus) : 'pending';

const parseSource = (raw: string): IntakeSource =>
  KNOWN_SOURCES.has(raw as IntakeSource) ? (raw as IntakeSource) : 'in_app';

const parseNumber = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function intakeFromApi(api: IntakeApi): Intake {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    status: parseStatus(api.status),
    source: parseSource(api.source),
    sourceEmail: api.sourceEmail,
    externalSource: api.externalSource,
    externalId: api.externalId,
    rawContent: api.rawContent,
    extractedTitle: api.extractedTitle,
    extractedDescription: api.extractedDescription,
    suggestedProjectId: api.suggestedProjectId,
    suggestedAssigneeId: api.suggestedAssigneeId,
    suggestedGoalId: api.suggestedGoalId,
    suggestedProjectName: api.suggestedProjectName ?? null,
    suggestedAssigneeName: api.suggestedAssigneeName ?? null,
    suggestedGoalTitle: api.suggestedGoalTitle ?? null,
    suggestedPriority: api.suggestedPriority
      ? parseIssuePriority(api.suggestedPriority)
      : null,
    suggestedDueDate: parseDate(api.suggestedDueDate),
    suggestedLabels: api.suggestedLabels ?? [],
    confidence: parseNumber(api.confidence),
    triagedByUserId: api.triagedByUserId,
    triagedAt: parseDate(api.triagedAt),
    rejectedReason: api.rejectedReason,
    snoozedUntil: parseDate(api.snoozedUntil),
    createdIssueId: api.createdIssueId,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

// ─── Accept resolver ────────────────────────────────────────────────────────

/**
 * Резолвит проект для accept входящей: явный projectId → suggested → null.
 * null означает «проект не определён, нужен ручной выбор» (открыть пикер).
 */
export function resolveAcceptTargetProjectId(
  item: Pick<Intake, 'projectId' | 'suggestedProjectId'>,
): string | null {
  return item.projectId ?? item.suggestedProjectId ?? null;
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

export function intakeDisplayTitle(intake: Intake): string {
  if (intake.extractedTitle && intake.extractedTitle.trim().length > 0) {
    return intake.extractedTitle;
  }
  const raw = intake.rawContent.trim();
  if (raw.length <= 80) return raw;
  return `${raw.slice(0, 77)}…`;
}
