import { z } from 'zod';

export const TriageDecisionSchema = z.enum([
  'accept',
  'reject',
  'snooze',
  'duplicate',
]);
export type TriageDecisionDto = z.infer<typeof TriageDecisionSchema>;

/**
 * Триаж intake-карточки. `accept` создаёт Issue в проекте `targetProjectId`
 * (или `intake.projectId` / `suggestedProjectId`). `snooze` требует
 * `snoozedUntil`. `duplicate` — `duplicateOfIssueId`.
 */
export const TriageIntakeSchema = z
  .object({
    decision: TriageDecisionSchema,
    /** Для accept: явный выбор проекта (если intake не привязан / autosuggest перебивается). */
    targetProjectId: z.string().max(64).nullable().optional(),
    /** Для accept: переопределение полей перед созданием Issue. */
    overrideTitle: z.string().max(500).nullable().optional(),
    overrideDescription: z.string().max(50_000).nullable().optional(),
    overrideAssigneeUserIds: z
      .array(z.string().min(1).max(64))
      .max(32)
      .nullable()
      .optional(),
    overridePriority: z
      .enum(['urgent', 'high', 'medium', 'low', 'none'])
      .nullable()
      .optional(),
    overrideGoalId: z.string().max(64).nullable().optional(),
    overrideDueDate: z.coerce.date().nullable().optional(),
    /** Для reject. */
    reason: z.string().max(2_000).nullable().optional(),
    /** Для snooze. */
    snoozedUntil: z.coerce.date().nullable().optional(),
    /** Для duplicate. */
    duplicateOfIssueId: z.string().max(64).nullable().optional(),
  })
  .strict();

export type TriageIntakeDto = z.infer<typeof TriageIntakeSchema>;

export const UpdateIntakeSchema = z
  .object({
    extractedTitle: z.string().max(500).nullable().optional(),
    extractedDescription: z.string().max(50_000).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
    suggestedProjectId: z.string().max(64).nullable().optional(),
    suggestedAssigneeId: z.string().max(64).nullable().optional(),
    suggestedGoalId: z.string().max(64).nullable().optional(),
    suggestedPriority: z
      .enum(['urgent', 'high', 'medium', 'low', 'none'])
      .nullable()
      .optional(),
    suggestedDueDate: z.coerce.date().nullable().optional(),
    suggestedLabels: z.array(z.string().min(1).max(64)).max(16).optional(),
  })
  .strict();

export type UpdateIntakeDto = z.infer<typeof UpdateIntakeSchema>;
