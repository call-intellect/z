import { z } from 'zod';

export const ClosedGroupKindSchema = z.enum(['leadership', 'council', 'personal']).nullable();
export type ClosedGroupKind = z.infer<typeof ClosedGroupKindSchema>;

export const SetMatrixSchema = z.object({
  visibleGroupIds: z
    .array(z.string().min(1).max(50))
    .max(200, 'Слишком много отделов в списке видимости'),
});
export type SetMatrixDto = z.infer<typeof SetMatrixSchema>;

export const AddMemberSchema = z.object({
  personId: z.string().min(1).max(50),
});
export type AddMemberDto = z.infer<typeof AddMemberSchema>;

export const SetClosedDefaultSchema = z.object({
  defaultClosedGroupKind: ClosedGroupKindSchema,
});
export type SetClosedDefaultDto = z.infer<typeof SetClosedDefaultSchema>;
