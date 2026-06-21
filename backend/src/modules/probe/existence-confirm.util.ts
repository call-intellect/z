export type ExistenceConfirmDecision =
  | { decisionType: 'approve' }
  | { decisionType: 'approve_with_edits'; field: 'name' | 'ownerPersonId' }
  | { decisionType: 'reject' };

export function mapExistenceConfirmAnswer(
  answer: string,
): ExistenceConfirmDecision | null {
  if (typeof answer !== 'string') return null;
  const text = answer.toLowerCase();
  if (text.includes('удал')) return { decisionType: 'reject' };
  if (text.includes('переименов')) {
    return { decisionType: 'approve_with_edits', field: 'name' };
  }
  if (text.includes('назнач')) {
    return { decisionType: 'approve_with_edits', field: 'ownerPersonId' };
  }
  if (text.includes('остав') || text.includes('подтверд') || text.includes('да')) {
    return { decisionType: 'approve' };
  }
  return null;
}
