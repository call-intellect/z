import { z } from 'zod';

import { type DialogTurn } from './common';
import type { AiParticipantContext } from './participant-context';
import { buildTasksPromptUnified, buildTasksSchemaUnified } from './tasks-unified';

export const TASKS_STRUCTURED_TASK_TYPE = 'tasks';

export const TaskExtractedSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000).nullable().optional(),
    assigneeRaw: z.string().max(200).nullable().optional(),
    assigneeUserId: z.string().max(100).nullable().optional(),
    dueDate: z.string().max(40).nullable().optional(),
    sourceStartMs: z.number().int().nonnegative(),
    sourceEndMs: z.number().int().nonnegative(),
    sourceQuote: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type TaskExtracted = z.infer<typeof TaskExtractedSchema>;

export const TasksExtractedArraySchema = z.array(TaskExtractedSchema);

export const TasksStructuredResponseSchema = z
  .object({ tasks: TasksExtractedArraySchema })
  .strict();

export const TASKS_STRUCTURED_OPTIONS = {
  enriched: false,
  useAssigneeRaw: true,
  withFragmentBounds: true,
  withSourceQuote: true,
  withConfidence: true,
} as const;

export function buildTasksStructuredJsonSchema(
  participants?: readonly AiParticipantContext[] | null,
): Record<string, unknown> {
  const hasParticipants = Array.isArray(participants) && participants.length > 0;
  return z.toJSONSchema(
    buildTasksSchemaUnified({
      ...TASKS_STRUCTURED_OPTIONS,
      ...(hasParticipants ? { participants } : {}),
    }),
    { target: 'draft-7' },
  ) as Record<string, unknown>;
}

export interface TasksStructuredPromptInput {
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
  participants?: readonly AiParticipantContext[];
}

export function buildTasksStructuredPrompt(input: TasksStructuredPromptInput): {
  system: string;
  user: string;
} {
  const participants = input.participants ?? [];
  return buildTasksPromptUnified(
    {
      meeting: {
        id: input.meeting.id,
        title: input.meeting.title,
        type: input.meeting.type,
      },
      dialog: input.dialog,
    },
    {
      ...TASKS_STRUCTURED_OPTIONS,
      ...(participants.length > 0 ? { participants } : {}),
    },
  );
}
