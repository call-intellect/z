import { z } from 'zod';

export const MitigationStepSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    done: z.boolean().optional().default(false),
  })
  .strict();
export type MitigationStep = z.infer<typeof MitigationStepSchema>;

export const MitigationPlanSchema = z
  .object({
    v: z.literal(1).optional().default(1),
    steps: z.array(MitigationStepSchema).min(1).max(50),
    ownerPersonId: z.string().min(1).nullable().optional().default(null),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD')
      .nullable()
      .optional()
      .default(null),
  })
  .strict();
export type MitigationPlan = z.infer<typeof MitigationPlanSchema>;

export function parseMitigationPlan(raw: string | null | undefined): MitigationPlan | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('{')) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = MitigationPlanSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function isStructuredMitigationPlan(raw: string | null | undefined): boolean {
  return parseMitigationPlan(raw) !== null;
}

export function serializeMitigationPlan(plan: MitigationPlan): string {
  const validated = MitigationPlanSchema.parse(plan);
  return JSON.stringify(validated);
}

export function mitigationPlanToText(raw: string | null | undefined): string | null {
  const structured = parseMitigationPlan(raw);
  if (structured) {
    return structured.steps.map((s) => s.text).join('; ');
  }
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}
