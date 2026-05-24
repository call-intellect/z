import { z } from 'zod';

export const ListProjectsQuerySchema = z
  .object({
    includeArchived: z.coerce.boolean().default(false),
    ownerId: z.string().max(64).optional(),
    q: z.string().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

export const AddProjectMemberSchema = z
  .object({
    userId: z.string().min(1).max(64),
    role: z.union([z.literal(5), z.literal(15), z.literal(20)]).default(15),
  })
  .strict();
export type AddProjectMemberDto = z.infer<typeof AddProjectMemberSchema>;
