import { z } from 'zod';

export const ContourSeedSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            question: z.string().min(1).max(2_000),
            answer: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export type ContourSeedDto = z.infer<typeof ContourSeedSchema>;
