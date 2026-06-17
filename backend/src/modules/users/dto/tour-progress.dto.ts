import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TourIdSchema = z.enum(['welcome', 'project', 'meeting', 'overview', 'demo']);
export type TourId = z.infer<typeof TourIdSchema>;

const TourEntrySchema = z
  .object({
    completedAt: z.string().datetime().optional(),
    skipped: z.boolean().optional(),
  })
  .strict();

export const UpdateTourProgressSchema = z
  .object({
    tourId: TourIdSchema,
    completedAt: z.string().datetime().optional(),
    skipped: z.boolean().optional(),
  })
  .strict();

export type UpdateTourProgressBody = z.infer<typeof UpdateTourProgressSchema>;
export class UpdateTourProgressDto extends createZodDto(UpdateTourProgressSchema) {}

export const TourProgressResponseSchema = z.object({
  welcome: TourEntrySchema.optional(),
  project: TourEntrySchema.optional(),
  meeting: TourEntrySchema.optional(),
  overview: TourEntrySchema.optional(),
  demo: TourEntrySchema.optional(),
});

export type TourProgressResponse = z.infer<typeof TourProgressResponseSchema>;
export class TourProgressResponseDto extends createZodDto(TourProgressResponseSchema) {}

export const TourProgressResetResponseSchema = z.object({
  ok: z.literal(true),
});

export type TourProgressResetResponse = z.infer<typeof TourProgressResetResponseSchema>;
export class TourProgressResetResponseDto extends createZodDto(TourProgressResetResponseSchema) {}
