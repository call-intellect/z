import { z } from 'zod';

/** DTO смены статуса тикета (stateId Support-проекта). */
export const DeskTransitionSchema = z
  .object({
    stateId: z.string().min(1).max(64),
  })
  .strict();

export type DeskTransitionDto = z.infer<typeof DeskTransitionSchema>;
