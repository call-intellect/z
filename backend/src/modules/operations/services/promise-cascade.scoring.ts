export interface CommitmentForCascade {
  id: string;
  authorPersonId: string | null;
  recipientPersonId: string | null;
  dueDate: Date | null;
  status: string | null;
  hasOutgoingDependency: boolean;
}

export function isCommitmentOverdue(
  c: Pick<CommitmentForCascade, 'dueDate' | 'status'>,
  now: Date,
): boolean {
  if (!c.dueDate) return false;
  if (c.dueDate.getTime() >= now.getTime()) return false;
  const status = (c.status ?? 'open').toLowerCase();
  return status === 'open' || status === 'asked';
}

export function isCascadeCritical(c: CommitmentForCascade, now: Date): boolean {
  if (!c.authorPersonId) return false;
  if (!c.hasOutgoingDependency) return false;
  return isCommitmentOverdue(c, now);
}

export function selectCascadeCritical(
  commitments: CommitmentForCascade[],
  now: Date,
): CommitmentForCascade[] {
  return commitments.filter((c) => isCascadeCritical(c, now));
}
