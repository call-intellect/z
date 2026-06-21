import { z } from 'zod';

import type { AssigneeSuggestion } from '../../services/skill-routing.service';

export const PostSuggestAssigneeBodySchema = z
  .object({
    taskText: z.string().trim().min(1).max(2_000),
    departmentId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type PostSuggestAssigneeBodyDto = z.infer<typeof PostSuggestAssigneeBodySchema>;

export interface PostSuggestAssigneeResponseDto {
  suggestions: AssigneeSuggestion[];
}
