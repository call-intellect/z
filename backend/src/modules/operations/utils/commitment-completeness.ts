import type { Prisma } from '@prisma/client';

export interface CommitmentCompletenessFields {
  commitmentAuthorPersonId: string | null;
  commitmentRecipientPersonId: string | null;
  commitmentDueDate: Date | null;
}

export function completeCommitmentWhere(): Prisma.IdeaBlockWhereInput {
  return {
    commitmentAuthorPersonId: { not: null },
    OR: [{ commitmentRecipientPersonId: { not: null } }, { commitmentDueDate: { not: null } }],
  };
}

export function isCompleteCommitment(block: CommitmentCompletenessFields): boolean {
  if (block.commitmentAuthorPersonId == null) return false;
  return block.commitmentRecipientPersonId != null || block.commitmentDueDate != null;
}

export function incompleteCommitmentReason(
  block: CommitmentCompletenessFields,
): 'no_author' | 'no_recipient_and_due' | null {
  if (block.commitmentAuthorPersonId == null) return 'no_author';
  if (block.commitmentRecipientPersonId == null && block.commitmentDueDate == null) {
    return 'no_recipient_and_due';
  }
  return null;
}

export function incompleteCommitmentReasonText(
  reason: 'no_author' | 'no_recipient_and_due',
): string {
  switch (reason) {
    case 'no_author':
      return 'не определён автор обещания';
    case 'no_recipient_and_due':
      return 'не назначен ответственный и нет срока';
  }
}
