import { z } from 'zod';

export const CreatePersonLeaveSchema = z
  .object({
    personId: z.string().min(1),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD'),
    kind: z.string().min(1).max(40).default('vacation'),
    comment: z.string().max(500).optional(),
  })
  .strict();
export type CreatePersonLeaveDto = z.infer<typeof CreatePersonLeaveSchema>;

export const ListPersonLeavesQuerySchema = z
  .object({
    personId: z.string().min(1).optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Дата должна быть в формате YYYY-MM-DD')
      .optional(),
  })
  .strict();
export type ListPersonLeavesQuery = z.infer<typeof ListPersonLeavesQuerySchema>;

export interface PersonLeaveResponseDto {
  id: string;
  personId: string;
  fromDate: string;
  toDate: string;
  kind: string;
  comment: string | null;
}

export interface ListPersonLeavesResponse {
  items: PersonLeaveResponseDto[];
}
