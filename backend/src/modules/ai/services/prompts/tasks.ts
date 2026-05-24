import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  type PromptInput,
  type PromptOutput,
  TasksSchema,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TASKS_TOOL_NAME = 'extract_tasks';
export const TASKS_SCHEMA = TasksSchema;

/**
 * System-промпт для базового tasks-агента (legacy `analyze.worker` step).
 *
 * Wave 3 / Tracker Phase 3 part B (2026-05-24): TASKS_TOOL расширен полями
 * для `MeetingExtractActionsService` — `suggestedAssigneeHint`,
 * `suggestedDueDate`, `suggestedPriority`, `confidence`, `sourceQuote`.
 * Все новые поля **optional** в JSON Schema, чтобы старые модели (которые
 * возвращают только title/assignee/dueDate) продолжали проходить
 * валидацию TASKS_SCHEMA. Это критично — legacy потребители (Task feature)
 * не должны сломаться.
 *
 * Промпт-блок про новые поля дописывается в `MeetingExtractActionsService`
 * через свой расширенный промпт (см. сервис). Здесь оставляем тривиальный
 * legacy-промпт.
 */
const TASKS_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список задач, которые были поставлены или зафиксированы.
Для каждой задачи укажи:
- "title": краткая формулировка задачи (на русском, императив).
- "assignee": ФИО или роль ответственного. Если ответственный не назван — null.
- "dueDate": срок в формате ISO-8601 (YYYY-MM-DD) или относительная фраза ("к концу недели"). Если срока нет — null.
Не выдумывай задач. Если задач не было — верни пустой массив.`;

export function buildTasksPrompt(input: PromptInput): PromptOutput {
  const dialog = turnsToText(input.dialog, input.roomChat);
  return {
    system: withRoomChatNote(
      withToolInstructions(TASKS_SYSTEM, TASKS_TOOL_NAME),
      input.roomChat,
    ),
    user: `Тип встречи: ${input.meeting.type}\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${dialog}`,
  };
}

export const TASKS_TOOL = buildExtractTool(
  TASKS_TOOL_NAME,
  'Извлечь задачи (поручения) из встречи',
  {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: fieldString,
          assignee: fieldNullableString,
          dueDate: fieldNullableString,
          // Wave 3 — обогащённые поля. additionalProperties=false, поэтому
          // обязаны быть в schema; required их не включает — модель может
          // вернуть только legacy-набор.
          suggestedAssigneeHint: fieldNullableString,
          suggestedDueDate: fieldNullableString,
          suggestedPriority: {
            type: ['string', 'null'] as const,
            enum: ['urgent', 'high', 'medium', 'low', null] as const,
          },
          confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
          sourceQuote: fieldString,
        },
        required: ['title', 'assignee', 'dueDate'],
        additionalProperties: false,
      },
    },
  },
  ['tasks'],
);

/**
 * Расширенный system-промпт для `meeting-extract-actions` (Wave 3 / Tracker
 * Phase 3 part B). Используется `MeetingExtractActionsService`. Отличается
 * от обычного TASKS_SYSTEM тем, что просит модель заполнять обогащённые
 * поля + ссылается на контекст организации (передаётся в user-части).
 *
 * Промпт деликатный — задачи попадают в IntakeIssue и потенциально
 * автоматически становятся Issue (при confidence ≥ 0.92). Модель должна:
 *  - формулировать задачу императивом и кратко;
 *  - возвращать `confidence` честно (0..1) — лучше осторожнее, чем
 *    «уверенно» с галлюцинацией;
 *  - всегда приводить `sourceQuote` — точную цитату из транскрипта,
 *    чтобы человек мог проверить.
 */
export const MEETING_EXTRACT_ACTIONS_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список задач, которые были поставлены или зафиксированы.

Для каждой задачи обязательно укажи:
- "title": краткая формулировка задачи (на русском, императив, до 100 символов).
- "assignee": ФИО или роль ответственного (как было произнесено). Если не назван — null.
- "dueDate": срок в формате ISO-8601 (YYYY-MM-DD). Если срок назван относительно ("к пятнице") — переведи в ISO-дату относительно даты встречи. Если срока нет — null.
- "suggestedAssigneeHint": нормализованное ФИО или роль ответственного для последующего match'инга с Person (например, "Иванов Сергей" вместо "Серёжа"). null если непонятно.
- "suggestedDueDate": та же дата, что и dueDate, но только ISO-8601 — без свободных фраз. null если срок не указан.
- "suggestedPriority": один из "urgent" | "high" | "medium" | "low" по контексту обсуждения. null если приоритет не обсуждался.
- "confidence": число 0..1 — насколько ты уверен, что это РЕАЛЬНАЯ задача (а не реплика "надо бы когда-нибудь"). 0.9+ только если явное поручение с ответственным.
- "sourceQuote": точная цитата из транскрипта длиной до 200 символов, на основании которой ты сформулировал задачу. ОБЯЗАТЕЛЬНО — без цитаты задача не валидна.

Контекст организации (проекты, цели, известные сотрудники) — в user-сообщении после диалога. Используй его, чтобы уточнять assignee/priority, но не выдумывай.

Не выдумывай задач. Если задач не было — верни пустой массив.`;

/**
 * Wave 3 — построитель user-сообщения для `meeting-extract-actions`.
 * Принимает базовый PromptInput + контекст организации (members/projects/
 * goals), который сервис собирает из БД. Все опциональны — на тестах
 * минимальные данные.
 */
export interface MeetingExtractActionsContext {
  /** Список проектов с их identifier+name для подсказки в промпте. */
  projects?: Array<{ identifier: string; name: string }>;
  /** Список активных целей. */
  goals?: Array<{ name: string }>;
  /** Известные сотрудники Org (Person.name) для уточнения assignee hint'а. */
  people?: Array<{ name: string; role?: string | null }>;
  /** Текущая дата встречи (ISO) — даёт модели опору для относительных сроков. */
  meetingDateIso?: string;
}

export function buildMeetingExtractActionsPrompt(
  input: PromptInput,
  ctx: MeetingExtractActionsContext = {},
): PromptOutput {
  const dialog = turnsToText(input.dialog, input.roomChat);
  const lines: string[] = [];
  lines.push(`Тип встречи: ${input.meeting.type}`);
  lines.push(`Заголовок: ${input.meeting.title}`);
  if (ctx.meetingDateIso) {
    lines.push(`Дата встречи: ${ctx.meetingDateIso}`);
  }
  if (ctx.projects && ctx.projects.length > 0) {
    lines.push('');
    lines.push('Проекты организации:');
    for (const p of ctx.projects.slice(0, 40)) {
      lines.push(`  - ${p.identifier}: ${p.name}`);
    }
  }
  if (ctx.goals && ctx.goals.length > 0) {
    lines.push('');
    lines.push('Активные цели:');
    for (const g of ctx.goals.slice(0, 30)) {
      lines.push(`  - ${g.name}`);
    }
  }
  if (ctx.people && ctx.people.length > 0) {
    lines.push('');
    lines.push('Сотрудники организации:');
    for (const p of ctx.people.slice(0, 60)) {
      lines.push(`  - ${p.name}${p.role ? ` (${p.role})` : ''}`);
    }
  }
  lines.push('');
  lines.push('Диалог:');
  lines.push(dialog);
  return {
    system: withRoomChatNote(
      withToolInstructions(MEETING_EXTRACT_ACTIONS_SYSTEM, TASKS_TOOL_NAME),
      input.roomChat,
    ),
    user: lines.join('\n'),
  };
}
