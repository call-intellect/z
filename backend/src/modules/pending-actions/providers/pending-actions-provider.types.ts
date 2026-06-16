export interface PendingActionItem {
  source: 'curation' | 'conflict' | 'intake' | 'probe';
  resourceType: string;
  resourceId: string;
  title: string;
  severity: 'normal' | 'urgent';
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
  detail?: PendingActionDetail;
}

export type PendingActionDetail =
  | ProbePendingDetail
  | ConflictPendingDetail
  | IntakePendingDetail
  | CurationPendingDetail;

export interface ProbePendingDetail {
  kind: 'probe';
  question: string;
  context?: string;
  meetingTitle?: string;
  cite?: string;
  notificationId: string;
}

export interface ConflictPendingDetail {
  kind: 'conflict';
  summary: string;
  oldVersion: { text: string; date?: string; cite?: string };
  newVersion: { text: string; date?: string; cite?: string };
}

export interface IntakePendingDetail {
  kind: 'intake';
  title: string;
  description?: string;
  assigneeName?: string;
  dueLabel?: string;
  confidence?: number;
  cite?: string;
}

export interface CurationPendingDetail {
  kind: 'curation';
  cardTitle: string;
  preview?: string;
  cite?: string;
}

export interface PendingActionsProviderArgs {
  tenantId: string;
  userId: string;
  role: string | null;
  snoozedResourceIds: Set<string>;
}

export interface PendingActionsProvider {
  readonly source: PendingActionItem['source'];
  countForUser(a: PendingActionsProviderArgs): Promise<number>;
  listForUser(a: PendingActionsProviderArgs & { limit: number }): Promise<PendingActionItem[]>;
}

export function isPrivileged(role: string | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function ageDaysFrom(createdAt: Date, now: Date): number {
  const ms = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
