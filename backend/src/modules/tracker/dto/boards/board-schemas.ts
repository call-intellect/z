import { z } from 'zod';

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/u, 'Цвет должен быть в формате #RRGGBB');

export const CreateBoardSchema = z
  .object({
    name: z.string().min(1).max(120),
    color: HexColorSchema.optional(),
    icon: z.string().max(40).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type CreateBoardDto = z.infer<typeof CreateBoardSchema>;

export const UpdateBoardSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    color: HexColorSchema.optional(),
    icon: z.string().max(40).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    sequence: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateBoardDto = z.infer<typeof UpdateBoardSchema>;

export const ReorderBoardsSchema = z
  .object({
    boardIds: z.array(z.string().min(1).max(64)).min(1).max(100),
  })
  .strict();
export type ReorderBoardsDto = z.infer<typeof ReorderBoardsSchema>;

export const ListBoardsQuerySchema = z
  .object({
    includeArchived: z.coerce.boolean().default(false),
  })
  .strict();
export type ListBoardsQuery = z.infer<typeof ListBoardsQuerySchema>;
