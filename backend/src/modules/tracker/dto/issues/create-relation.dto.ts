import { z } from 'zod';

export const IssueRelationTypeSchema = z.enum([
  'blocks',
  'blocked_by',
  'duplicates',
  'duplicated_by',
  'relates_to',
]);
export type IssueRelationType = z.infer<typeof IssueRelationTypeSchema>;

export const CreateIssueRelationSchema = z
  .object({
    targetIssueId: z.string().min(1).max(64),
    relationType: IssueRelationTypeSchema,
  })
  .strict();
export type CreateIssueRelationDto = z.infer<typeof CreateIssueRelationSchema>;

export interface IssueRelationDto {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  relationType: IssueRelationType | string;
  createdById: string;
  createdAt: string;
  direction: 'out' | 'in';
}

export function oppositeRelationType(relationType: IssueRelationType): IssueRelationType | null {
  switch (relationType) {
    case 'blocks':
      return 'blocked_by';
    case 'blocked_by':
      return 'blocks';
    case 'duplicates':
      return 'duplicated_by';
    case 'duplicated_by':
      return 'duplicates';
    case 'relates_to':
      return 'relates_to';
    default:
      return null;
  }
}
