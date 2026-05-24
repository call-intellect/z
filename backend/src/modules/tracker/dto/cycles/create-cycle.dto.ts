import { z } from 'zod';

export const CreateCycleSchema = z
  .object({
    name: z.string().min(1).max(200),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    ownedById: z.string().max(64).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    timezone: z.string().max(64).default('Europe/Moscow'),
  })
  .strict()
  .refine((d) => d.endDate.getTime() > d.startDate.getTime(), {
    message: 'endDate должен быть позже startDate',
    path: ['endDate'],
  });

export type CreateCycleDto = z.infer<typeof CreateCycleSchema>;
