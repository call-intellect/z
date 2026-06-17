import { z } from 'zod';

import type { LlmTool } from '../llm.types';

import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  type PromptInput,
  type PromptOutput,
  TaskItemSchema,
  TasksSchema,
  turnsToText,
  withConfidenceCalibration,
  withNotATaskDiscriminator,
  withRoomChatNote,
  withToolInstructions,
} from './common';
import {
  type AiParticipantContext,
  formatParticipantsForPrompt,
  PARTICIPANT_IDENTIFICATION_RULES,
} from './participant-context';

export interface TasksPromptOptions {
  enriched?: boolean;
  withConfidence?: boolean;
  withSourceQuote?: boolean;
  withFragmentBounds?: boolean;
  useAssigneeRaw?: boolean;
  responseAsBareArray?: boolean;
  includeOptionalFields?: boolean;
  calibrationOnly?: boolean;
  meetingDateIso?: string;
  orgContext?: TasksOrgContext;
  participants?: readonly AiParticipantContext[];
}

export interface TasksOrgContext {
  projects?: Array<{ identifier: string; name: string }>;
  goals?: Array<{ name: string }>;
  people?: Array<{ name: string; role?: string | null }>;
}

export const TASKS_UNIFIED_TOOL_NAME = 'extract_tasks';

export function buildTaskItemSchemaUnified(opts: TasksPromptOptions): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    title: z.string().min(1),
  };

  if (opts.useAssigneeRaw) {
    shape['description'] = z.string().max(2000).nullable().optional();
    shape['assigneeRaw'] = z.string().max(200).nullable().optional();
  } else {
    shape['assignee'] = z.string().nullable();
  }

  if (opts.participants && opts.participants.length > 0) {
    shape['assigneeUserId'] = z.string().max(100).nullable().optional();
  }

  shape['dueDate'] = z.string().max(40).nullable().optional();

  if (opts.enriched) {
    shape['suggestedAssigneeHint'] = z.string().nullable().optional();
    shape['suggestedDueDate'] = z.string().nullable().optional();
    shape['suggestedPriority'] = z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional();
  }

  if (opts.withFragmentBounds) {
    shape['sourceStartMs'] = z.number().int().nonnegative();
    shape['sourceEndMs'] = z.number().int().nonnegative();
  }

  if (opts.withSourceQuote) {
    shape['sourceQuote'] = z.string().min(1).max(2000);
  }

  if (opts.withConfidence) {
    shape['confidence'] = z.number().min(0).max(1);
  }

  return z.object(shape).strict();
}

export function buildTasksSchemaUnified(opts: TasksPromptOptions): z.ZodTypeAny {
  const item = buildTaskItemSchemaUnified(opts);
  return z.object({ tasks: z.array(item) }).strict();
}

export function buildTasksToolUnified(opts: TasksPromptOptions): LlmTool {
  const taskProperties: Record<string, unknown> = {
    title: fieldString,
  };
  const taskRequired: string[] = ['title'];
  const lax = opts.includeOptionalFields === true;

  if (opts.useAssigneeRaw) {
    taskProperties['description'] = fieldNullableString;
    taskProperties['assigneeRaw'] = fieldNullableString;
  } else {
    taskProperties['assignee'] = fieldNullableString;
    taskRequired.push('assignee');
  }

  if (opts.participants && opts.participants.length > 0) {
    taskProperties['assigneeUserId'] = fieldNullableString;
  }

  taskProperties['dueDate'] = fieldNullableString;
  if (!opts.useAssigneeRaw) {
    taskRequired.push('dueDate');
  }

  if (opts.enriched || lax) {
    taskProperties['suggestedAssigneeHint'] = fieldNullableString;
    taskProperties['suggestedDueDate'] = fieldNullableString;
    taskProperties['suggestedPriority'] = {
      type: ['string', 'null'] as const,
      enum: ['urgent', 'high', 'medium', 'low', null] as const,
    };
  }

  if (opts.withFragmentBounds) {
    taskProperties['sourceStartMs'] = {
      type: 'integer' as const,
      minimum: 0,
    };
    taskProperties['sourceEndMs'] = {
      type: 'integer' as const,
      minimum: 0,
    };
    taskRequired.push('sourceStartMs', 'sourceEndMs');
  }

  if (opts.withSourceQuote || lax) {
    taskProperties['sourceQuote'] = fieldString;
    if (opts.withSourceQuote && !lax && (opts.useAssigneeRaw || opts.enriched)) {
      taskRequired.push('sourceQuote');
    }
  }

  if (opts.withConfidence || lax) {
    taskProperties['confidence'] = {
      type: 'number' as const,
      minimum: 0,
      maximum: 1,
    };
    if (opts.withConfidence && !lax) {
      taskRequired.push('confidence');
    }
  }

  return buildExtractTool(
    TASKS_UNIFIED_TOOL_NAME,
    'Извлечь задачи (поручения) из встречи',
    {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: taskProperties,
          required: taskRequired,
          additionalProperties: false,
        },
      },
    },
    ['tasks'],
  );
}

const BASE_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список задач, которые были поставлены или зафиксированы.

Для каждой задачи укажи:
- "title": краткая формулировка задачи (на русском, императив, до 100 символов).
- "assignee": ФИО или роль ответственного (как было произнесено). Если не назван — null.
- "dueDate": срок: ISO-8601 (YYYY-MM-DD) или относительная фраза («к концу недели», «до пятницы»). null — если срока нет.

Не выдумывай задач. Если задач не было — верни пустой массив.

Различай строго: обязательство («я сделаю», «беру на себя») = ЗАДАЧА; пожелание («надо бы», «хорошо бы») и идея («было бы здорово») — НЕ задачи, не извлекай их как задачи. Если исполнитель неоднозначен или спикер не определён — assignee=null (не выводи из контекста). null — это честный сигнал отсутствия, а не пробел для заполнения.`;

const STRUCTURED_BASE_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список action items (задач, которые были поставлены или зафиксированы).

Правила:
- Извлекай только реальные задачи. Если задач не было — верни пустой массив [].
- "title" — краткая формулировка задачи (на русском, императив).
- "description" — расширенное описание, если в разговоре есть детали (или null).
- "assigneeRaw" — ФИО, ник или роль ответственного, как было сказано в разговоре (или null).
- "dueDate" — срок: ISO-8601 (YYYY-MM-DD) или относительная фраза («к концу недели», «до пятницы»). null — если срока нет.

Различай строго: обязательство («я сделаю», «беру на себя») = ЗАДАЧА; пожелание («надо бы», «хорошо бы») и идея («было бы здорово») — НЕ задачи, не извлекай их как задачи. Если исполнитель неоднозначен или спикер не определён — assignee=null (не выводи из контекста). null — это честный сигнал отсутствия, а не пробел для заполнения.`;

const ENRICHED_FIELDS_BLOCK = `
Дополнительные поля (обогащённый формат):
- "suggestedAssigneeHint": нормализованное ФИО или роль ответственного для последующего match'инга с Person (например, "Иванов Сергей" вместо "Серёжа"). null если непонятно.
- "suggestedDueDate": та же дата, что и dueDate, но только ISO-8601 — без свободных фраз. null если срок не указан.
- "suggestedPriority": один из "urgent" | "high" | "medium" | "low" по контексту обсуждения. null если приоритет не обсуждался.

Контекст организации (проекты, цели, известные сотрудники) — в user-сообщении после диалога. Используй его, чтобы уточнять assignee/priority, но не выдумывай.`;

const FRAGMENT_BOUNDS_BLOCK = `
Поля привязки к фрагменту (для подсветки в плеере):
- "sourceStartMs", "sourceEndMs" — миллисекунды от начала встречи: фрагмент, где задача была сформулирована.`;

const SOURCE_QUOTE_BLOCK = `
Поле "sourceQuote" — точная цитата из транскрипта длиной до 200 символов (1-3 предложения), на основании которой ты сформулировал задачу. ОБЯЗАТЕЛЬНО — без цитаты задача не валидна.`;

const CONFIDENCE_FIELD_BLOCK = `
Поле "confidence" — число 0..1: насколько ты уверен, что это РЕАЛЬНАЯ задача (а не реплика «надо бы когда-нибудь»). 0.9+ только если явное поручение с ответственным.`;

const BARE_ARRAY_INSTRUCTION = `

Формат ответа: ТОЛЬКО валидный JSON-массив. Без текста до или после, без markdown-обёрток.`;

function buildSystemUnified(opts: TasksPromptOptions, roomChat: PromptInput['roomChat']): string {
  let body = opts.useAssigneeRaw ? STRUCTURED_BASE_SYSTEM : BASE_SYSTEM;

  if (opts.enriched) body += `\n${ENRICHED_FIELDS_BLOCK}`;
  if (opts.withFragmentBounds) body += `\n${FRAGMENT_BOUNDS_BLOCK}`;
  if (opts.withSourceQuote) body += `\n${SOURCE_QUOTE_BLOCK}`;
  if (opts.withConfidence) body += `\n${CONFIDENCE_FIELD_BLOCK}`;
  if (opts.participants && opts.participants.length > 0) {
    body += `\n\nПоле "assigneeUserId" — User.id из списка участников этой встречи (см. ниже в user-сообщении). null если исполнитель — не зарегистрированный сотрудник встречи.\n${PARTICIPANT_IDENTIFICATION_RULES}`;
  }

  if (opts.responseAsBareArray) {
    body += BARE_ARRAY_INSTRUCTION;
  } else {
    body = withToolInstructions(body, TASKS_UNIFIED_TOOL_NAME);
  }

  body = withRoomChatNote(body, roomChat);

  if (opts.withConfidence || opts.calibrationOnly) {
    body = withConfidenceCalibration(body);
  }

  body = withNotATaskDiscriminator(body);

  return body;
}

function buildUserUnified(input: PromptInput, opts: TasksPromptOptions): string {
  const lines: string[] = [];
  lines.push(`Тип встречи: ${input.meeting.type}`);
  lines.push(`Заголовок: ${input.meeting.title}`);

  if (opts.meetingDateIso) {
    lines.push(`Дата встречи: ${opts.meetingDateIso}`);
  }

  const ctx = opts.orgContext;
  if (ctx?.projects && ctx.projects.length > 0) {
    lines.push('');
    lines.push('Проекты организации:');
    for (const p of ctx.projects.slice(0, 40)) {
      lines.push(`  - ${p.identifier}: ${p.name}`);
    }
  }
  if (ctx?.goals && ctx.goals.length > 0) {
    lines.push('');
    lines.push('Активные цели:');
    for (const g of ctx.goals.slice(0, 30)) {
      lines.push(`  - ${g.name}`);
    }
  }
  if (ctx?.people && ctx.people.length > 0) {
    lines.push('');
    lines.push('Сотрудники организации:');
    for (const p of ctx.people.slice(0, 60)) {
      lines.push(`  - ${p.name}${p.role ? ` (${p.role})` : ''}`);
    }
  }

  if (opts.participants && opts.participants.length > 0) {
    lines.push('');
    lines.push('Участники этой встречи (для assigneeUserId):');
    lines.push(formatParticipantsForPrompt(opts.participants));
  }

  lines.push('');
  if (opts.withFragmentBounds) {
    lines.push('Диалог (timestamps в формате [mm:ss-mm:ss]):');
  } else {
    lines.push('Диалог:');
  }
  lines.push(turnsToText(input.dialog, input.roomChat));

  if (opts.responseAsBareArray) {
    lines.push('');
    lines.push('Верни JSON-массив задач. Reply with valid JSON only.');
  }

  return lines.join('\n');
}

export function buildTasksPromptUnified(
  input: PromptInput,
  opts: TasksPromptOptions = {},
): PromptOutput {
  return {
    system: buildSystemUnified(opts, input.roomChat),
    user: buildUserUnified(input, opts),
  };
}

export { TaskItemSchema, TasksSchema };
