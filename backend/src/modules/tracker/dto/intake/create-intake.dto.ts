import { z } from 'zod';

export const IntakeSourceSchema = z.enum([
  'in_app',
  'email',
  'telegram',
  'checkin',
  'meeting',
  'api',
  'concierge',
]);

export const CreateIntakeSchema = z
  .object({
    source: IntakeSourceSchema,
    rawContent: z.string().min(1).max(50_000),
    sourceEmail: z.string().email().max(320).nullable().optional(),
    externalSource: z.string().max(40).nullable().optional(),
    externalId: z.string().max(200).nullable().optional(),
    extractedTitle: z.string().max(500).nullable().optional(),
    extractedDescription: z.string().max(50_000).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
    suggestedProjectId: z.string().max(64).nullable().optional(),
    suggestedAssigneeId: z.string().max(64).nullable().optional(),
    suggestedGoalId: z.string().max(64).nullable().optional(),
    suggestedPriority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).nullable().optional(),
    suggestedDueDate: z.coerce.date().nullable().optional(),
    suggestedLabels: z.array(z.string().min(1).max(64)).max(16).default([]),
    sourceBlockIds: z.array(z.string().min(1).max(64)).max(64).default([]),
    /**
     * Фикс linkedMeetingIds 2026-06-17 — ID встречи-источника (source='meeting').
     * Internal-поле: прокидывается createFromMeetingNextStep; при авто-приёме идёт
     * в Issue.linkedMeetingIds. Внешний REST обычно не посылает.
     */
    meetingId: z.string().max(200).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

export type CreateIntakeDto = z.infer<typeof CreateIntakeSchema>;

export const ListIntakeQuerySchema = z
  .object({
    status: z.enum(['pending', 'snoozed', 'accepted', 'rejected', 'duplicate']).optional(),
    source: IntakeSourceSchema.optional(),
    projectId: z.string().max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListIntakeQuery = z.infer<typeof ListIntakeQuerySchema>;
