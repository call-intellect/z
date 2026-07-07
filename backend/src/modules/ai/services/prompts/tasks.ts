import { type PromptInput, type PromptOutput, TasksSchema } from './common';
import {
  buildTasksPromptUnified,
  buildTasksToolUnified,
  TASKS_UNIFIED_TOOL_NAME,
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
