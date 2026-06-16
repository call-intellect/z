import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SubmitFeedbackSchema = z.object({
  text: z.string().min(1).max(5000),
});

export type SubmitFeedbackBody = z.infer<typeof SubmitFeedbackSchema>;
export class SubmitFeedbackDto extends createZodDto(SubmitFeedbackSchema) {}
