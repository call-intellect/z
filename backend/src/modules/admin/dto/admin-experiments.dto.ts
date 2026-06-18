import { z } from 'zod';

const PROVIDER_MODEL_REGEX = /^[a-z][a-z0-9-]*:[A-Za-z0-9-_.]+$/;

export const StartExperimentSchema = z.object({
  taskType: z.string().min(1).max(100),
  modelB: z.string().min(3).max(200).regex(PROVIDER_MODEL_REGEX, '<provider>:<model>'),
  splitPercent: z.number().int().min(1).max(99).default(50),
  durationDays: z.number().int().min(1).max(30).default(7),
});
export type StartExperimentDto = z.infer<typeof StartExperimentSchema>;

export const FinishExperimentSchema = z.object({
  winner: z.enum(['A', 'B']),
});
export type FinishExperimentDto = z.infer<typeof FinishExperimentSchema>;
