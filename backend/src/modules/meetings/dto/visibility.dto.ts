import { z } from 'zod';

/** ТЗ 2026-06-10 meeting-visibility Ф4 — тело PATCH /meetings/:id/visibility. */
export const SetVisibilitySchema = z.object({
  scope: z.enum(['owner_only', 'participants', 'custom', 'org']),
  grants: z
    .array(
      z.object({
        granteeType: z.enum(['person', 'group']),
        granteeId: z.string().min(1).max(50),
      }),
    )
    .max(200)
    .optional(),
});
export type SetVisibilityBody = z.infer<typeof SetVisibilitySchema>;
