import type { MeetingType } from '@prisma/client';

import type {
  PromptResolverTaskType,
  ResolvedPrompt,
  ResolvedPromptSection,
} from './prompt-resolver.types';
import { FOLLOW_UP_SCHEMA, FOLLOW_UP_TOOL, FOLLOW_UP_TOOL_NAME } from './prompts/follow-up';
import { getPromptForType } from './prompts/index';
import { SUMMARY_TOOL_NAME } from './prompts/system-summary';
import { TASKS_TOOL, TASKS_TOOL_NAME } from './prompts/tasks';

function castSchema(input: unknown): ResolvedPrompt['outputSchema'] {
  const schema = input as ResolvedPrompt['outputSchema'];
  return {
    type: 'object',
    properties: schema.properties ?? {},
    required: schema.required,
    additionalProperties: schema.additionalProperties,
  };
}

function sectionsFromSchema(schema: ResolvedPrompt['outputSchema']): ResolvedPromptSection[] {
  const required = new Set(schema.required ?? []);
  const props = schema.properties as Record<
    string,
    { type?: string | string[]; description?: string }
  >;
  const out: ResolvedPromptSection[] = [];
  let order = 1;
  for (const [key, propRaw] of Object.entries(props)) {
    const prop = propRaw ?? {};
    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
    let outputType: ResolvedPromptSection['outputType'] = 'text';
    if (type === 'array') outputType = 'bullet_list';
    else if (type === 'object') outputType = 'json_object';
    out.push({
      key,
      title: humanizeKey(key),
      instruction: prop.description ?? `Заполни поле "${key}" согласно схеме.`,
      outputType,
      required: required.has(key),
    });
    order += 1;
  }
  void order;
  return out;
}

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function codeFallbackSummary(type: MeetingType): ResolvedPrompt {
  const descriptor = getPromptForType(type);
  const dummy = descriptor.buildPrompt({
    meeting: { id: '__cf__', title: '__cf__', type, customPrompt: null },
    dialog: [],
  });
  const schema = castSchema(descriptor.tool.input_schema);
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: dummy.system,
    toolName: descriptor.toolName,
    toolDescription: descriptor.tool.description,
    sections: sectionsFromSchema(schema),
    outputSchema: schema,
  };
}

function codeFallbackPlainSummary(): ResolvedPrompt {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildSummaryPrompt } = require('./prompts/system-summary');
  const dummy = (buildSummaryPrompt as (input: unknown) => { system: string; user: string })({
    meeting: { id: '__cf__', title: '__cf__', type: 'team' },
    dialog: [],
  });
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: dummy.system,
    toolName: SUMMARY_TOOL_NAME,
    sections: [
      {
        key: 'summary',
        title: 'Саммари',
        instruction:
          'Сделай связный текст из 2-3 предложений: о чём была встреча, ключевые договорённости.',
        outputType: 'text',
        required: true,
      },
    ],
    outputSchema: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false,
    },
  };
}

function codeFallbackTasks(): ResolvedPrompt {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildTasksPrompt } = require('./prompts/tasks');
  const dummy = (buildTasksPrompt as (input: unknown) => { system: string; user: string })({
    meeting: { id: '__cf__', title: '__cf__', type: 'team' },
    dialog: [],
  });
  const schema = castSchema(TASKS_TOOL.input_schema);
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: dummy.system,
    toolName: TASKS_TOOL_NAME,
    toolDescription: TASKS_TOOL.description,
    sections: sectionsFromSchema(schema),
    outputSchema: schema,
  };
}

function codeFallbackFollowUp(): ResolvedPrompt {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildFollowUpPrompt } = require('./prompts/follow-up');
  const dummy = (buildFollowUpPrompt as (input: unknown) => { system: string; user: string })({
    meeting: { id: '__cf__', title: '__cf__', type: 'sales' },
    dialog: [],
  });
  const schema = castSchema(FOLLOW_UP_TOOL.input_schema);
  void FOLLOW_UP_SCHEMA;
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: dummy.system,
    toolName: FOLLOW_UP_TOOL_NAME,
    toolDescription: FOLLOW_UP_TOOL.description,
    sections: sectionsFromSchema(schema),
    outputSchema: schema,
  };
}

function codeFallbackCardRollup(): ResolvedPrompt {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildCardRollupSystemPrompt } = require('./prompts/card-rollup');
  const system = (buildCardRollupSystemPrompt as (k: string) => string)('custom');
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: system,
    toolName: null,
    sections: [
      {
        key: 'overview',
        title: 'Обзор карточки',
        instruction:
          'Сожми набор саммари встреч карточки в 2-4 абзаца или 4-6 буллетов. Markdown допустим. Не повторяй сами саммари — выдели общие темы, прогресс, открытые вопросы.',
        outputType: 'text',
        required: true,
      },
    ],
    outputSchema: {
      type: 'object',
      properties: { overview: { type: 'string' } },
      required: ['overview'],
      additionalProperties: false,
    },
  };
}

export function codeFallbackForMeeting(
  meetingType: MeetingType,
  taskType: PromptResolverTaskType,
): ResolvedPrompt {
  switch (taskType) {
    case 'summary':
      return codeFallbackSummary(meetingType);
    case 'tasks':
      return codeFallbackTasks();
    case 'follow-up':
      return codeFallbackFollowUp();
    case 'card-rollup':
      return codeFallbackCardRollup();
    case 'chapters':
    case 'meeting-quality-score':
    case 'behavior-refine':
    case 'transcript-clean-refine':
    case 'custom-report':
      throw new Error(
        `codeFallbackForMeeting: taskType '${taskType}' не имеет общего code-fallback. ` +
          `Используйте свой адаптер из соответствующей фазы (meeting-report-fast / B / D / E).`,
      );
  }
}

export function codeFallbackPlainSummaryPublic(): ResolvedPrompt {
  return codeFallbackPlainSummary();
}
