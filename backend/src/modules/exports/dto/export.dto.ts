import { z } from 'zod';

export const BulkExportSchema = z.object({
  meetingIds: z.array(z.string().min(1)).min(1).max(200),
  options: z
    .object({
      includeTranscript: z.boolean().optional(),
      includeAudio: z.boolean().optional(),
      includeVideo: z.boolean().optional(),
    })
    .default({}),
});

export type BulkExportDto = z.infer<typeof BulkExportSchema>;
