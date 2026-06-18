import { type PromptInput, type PromptOutput, TasksSchema } from './common';
import {
  buildTasksPromptUnified,
  buildTasksToolUnified,
  TASKS_UNIFIED_TOOL_NAME,
  type TasksOrgContext,
} from './tasks-unified';

export const TASKS_TOOL_NAME = TASKS_UNIFIED_TOOL_NAME;

export const TASKS_SCHEMA = TasksSchema;

export const TASKS_TOOL = buildTasksToolUnified({
  includeOptionalFields: true,
});

export function buildTasksPrompt(input: PromptInput): PromptOutput {
  return buildTasksPromptUnified(input, {
    enriched: false,
    withConfidence: false,
    withSourceQuote: false,
    calibrationOnly: true,
  });
}

export interface MeetingExtractActionsContext extends TasksOrgContext {
  meetingDateIso?: string;
}

export function buildMeetingExtractActionsPrompt(
  input: PromptInput,
  ctx: MeetingExtractActionsContext = {},
): PromptOutput {
  return buildTasksPromptUnified(input, {
    enriched: true,
    withConfidence: true,
    withSourceQuote: true,
    ...(ctx.meetingDateIso !== undefined ? { meetingDateIso: ctx.meetingDateIso } : {}),
    orgContext: {
      ...(ctx.projects !== undefined ? { projects: ctx.projects } : {}),
      ...(ctx.goals !== undefined ? { goals: ctx.goals } : {}),
      ...(ctx.people !== undefined ? { people: ctx.people } : {}),
    },
  });
}

export const MEETING_EXTRACT_ACTIONS_SYSTEM: string = (() => {
  const dummy: PromptInput = {
    meeting: { id: '__legacy__', title: '__legacy__', type: 'team' },
    dialog: [],
  };
  return buildMeetingExtractActionsPrompt(dummy).system;
})();
