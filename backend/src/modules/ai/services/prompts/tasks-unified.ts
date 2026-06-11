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
  withRoomChatNote,
  withToolInstructions,
} from './common';
import {
  type AiParticipantContext,
  formatParticipantsForPrompt,
  PARTICIPANT_IDENTIFICATION_RULES,
} from './participant-context';

/**
 * Wave 3 / ТЗ 2026-05-24 prompts-hardening §8 (F5).
 *
 * Единый builder для извлечения задач из встречи. Заменяет три исторических
 * пути:
 *
 *   1. `prompts/tasks.ts::buildTasksPrompt` — legacy для `AiResult.tasks`
 *      (3 поля: title / assignee / dueDate). Используется `analyze.worker`.
 *   2. `prompts/tasks.ts::buildMeetingExtractActionsPrompt` — обогащённый
 *      вариант для `MeetingExtractActionsService` → `IntakeIssue` (Wave 3).
 *      8 полей: + suggestedAssigneeHint / suggestedDueDate /
 *      suggestedPriority / confidence / sourceQuote.
 *   3. `prompts/tasks-structured.ts::buildTasksStructuredPrompt` — для модели
 *      `Task` + `MeetingHighlight` (используется `TaskExtractionService`).
 *      Поля близкие к #2 (`assigneeRaw` вместо `assignee`,
 *      `sourceStartMs`/`sourceEndMs` для привязки к фрагменту).
 *
 * Все три промта просили «не выдумывай», но формулировки разные. Confidence
 * был optional без min/max в `TASKS_TOOL` (конфликт с промтом). Единый
 * builder параметризован опциями и собирает корректную схему + system.
 *
 * Три legacy-обёртки (`buildTasksPrompt`, `buildMeetingExtractActionsPrompt`,
 * `buildTasksStructuredPrompt`) остаются как тонкие враппера для обратной
 * совместимости с уже подключёнными caller'ами. При следующем рефакторинге
 * caller'ы должны мигрировать на `buildTasksPromptUnified` напрямую.
 */

// ─────────────────── public types ─────────────────────────────────────────

/**
 * Опции единого builder'а tasks-промта.
 *
 *  - `enriched=true`        — обогащённый формат: добавляет
 *                             `suggestedAssigneeHint`, `suggestedDueDate`,
 *                             `suggestedPriority`. Используется Wave 3 /
 *                             Tracker Phase 3 (meeting-extract-actions).
 *  - `withConfidence=true`  — поле `confidence: number ∈ [0,1]` с
 *                             enforcement (НЕ optional). Также подмешивается
 *                             `CONFIDENCE_CALIBRATION` в system (F2).
 *  - `withSourceQuote=true` — поле `sourceQuote: string` (обязательное)
 *                             для аудита/UI. Без цитаты задача не валидна.
 *  - `withFragmentBounds=true` — поля `sourceStartMs` / `sourceEndMs`
 *                             (миллисекунды от начала встречи). Нужно для
 *                             `tasks-structured` (привязка к фрагменту для
 *                             модели `Task`).
 *  - `useAssigneeRaw=true`  — переименовывает `assignee` → `assigneeRaw`
 *                             и добавляет поле `description`. Нужно для
 *                             `tasks-structured` (контракт модели `Task`).
 *  - `responseAsBareArray=true` — отвечать ТОЛЬКО JSON-массивом без
 *                             обёртки `{ tasks: [...] }` (для legacy
 *                             `tasks-structured` пути с
 *                             `responseFormat: json_object`).
 *  - `includeOptionalFields=true` — добавить в JSON-Schema поля
 *                             confidence/sourceQuote/suggested* как
 *                             optional (НЕ в `required`). Нужно для
 *                             legacy `TASKS_TOOL` совместимости: схема
 *                             включала эти поля, но required был только
 *                             `['title', 'assignee', 'dueDate']`. Когда
 *                             `withConfidence: true` или `withSourceQuote:
 *                             true` без этого флага — поля становятся
 *                             required (это поведение для новых caller'ов).
 *  - `meetingDateIso`       — дата встречи (ISO YYYY-MM-DD) для перевода
 *                             относительных сроков.
 *  - `orgContext`           — проекты/цели/сотрудники (Wave 3),
 *                             подмешиваются в user.
 */
export interface TasksPromptOptions {
  enriched?: boolean;
  withConfidence?: boolean;
  withSourceQuote?: boolean;
  withFragmentBounds?: boolean;
  useAssigneeRaw?: boolean;
  responseAsBareArray?: boolean;
  includeOptionalFields?: boolean;
  /**
   * Подмешать `CONFIDENCE_CALIBRATION` (F2) в system, НЕ добавляя при
   * этом блок «Поле confidence — число...» (т.е. без требования
   * возвращать confidence). Используется legacy `buildTasksPrompt` —
   * F2 ранее добавил калибровку, но не делал confidence обязательным
   * полем. Если уже выставлен `withConfidence: true` — этот флаг
   * избыточен (калибровка добавится автоматически).
   */
  calibrationOnly?: boolean;
  meetingDateIso?: string;
  orgContext?: TasksOrgContext;
  /**
   * ТЗ 2026-05-25 hard-participant-identification: список участников встречи
   * для жёсткой идентификации `assigneeUserId`. Если непустой — добавляется
   * блок «Участники этой встречи» в user-сообщение, правила идентификации
   * в system, и поле `assigneeUserId: string | null` в schema задачи.
   */
  participants?: readonly AiParticipantContext[];
}

export interface TasksOrgContext {
  /** Список проектов с identifier+name для подсказки модели. */
  projects?: Array<{ identifier: string; name: string }>;
  /** Список активных целей организации. */
  goals?: Array<{ name: string }>;
  /** Известные сотрудники Org (Person.name) для уточнения assignee hint'а. */
  people?: Array<{ name: string; role?: string | null }>;
}

/** Единое имя tool'а для всех вариантов унифицированного builder'а. */
export const TASKS_UNIFIED_TOOL_NAME = 'extract_tasks';

// ─────────────────── Zod-схема ────────────────────────────────────────────

/**
 * Динамическая Zod-схема под опции. Когда `withConfidence: true` —
 * `confidence: number().min(0).max(1)` (НЕ optional, заставляем модель
 * честно возвращать). Когда `withSourceQuote: true` — `sourceQuote: string`
 * (обязательное). Когда `enriched: true` — добавляет suggested*-поля.
 *
 * Когда `useAssigneeRaw: true` — поле `assignee` переименовано в
 * `assigneeRaw` и добавляется `description`. Это контракт `Task`-модели
 * (см. `prompts/tasks-structured.ts`).
 *
 * Возвращает схему ОДНОГО task'а. Для wrapped-варианта (объект `{ tasks: [...] }`)
 * см. `buildTasksWrapperSchemaUnified`.
 */
export function buildTaskItemSchemaUnified(
  opts: TasksPromptOptions,
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {
    title: z.string().min(1),
  };

  if (opts.useAssigneeRaw) {
    shape['description'] = z.string().max(2000).nullable().optional();
    shape['assigneeRaw'] = z.string().max(200).nullable().optional();
  } else {
    shape['assignee'] = z.string().nullable();
  }

  // ТЗ 2026-05-25 — поле assigneeUserId добавляем, если передан список
  // участников. nullable+optional: LLM может вернуть null или вообще не
  // включить поле (старая модель). Резолвер обработает оба варианта.
  if (opts.participants && opts.participants.length > 0) {
    shape['assigneeUserId'] = z.string().max(100).nullable().optional();
  }

  // dueDate — всегда есть (в каком-то виде). Для structured-пути — может
  // быть свободной фразой; для legacy-пути — null или ISO; для enriched —
  // null или относительная.
  shape['dueDate'] = z.string().max(40).nullable().optional();

  if (opts.enriched) {
    shape['suggestedAssigneeHint'] = z.string().nullable().optional();
    shape['suggestedDueDate'] = z.string().nullable().optional();
    shape['suggestedPriority'] = z
      .enum(['urgent', 'high', 'medium', 'low'])
      .nullable()
      .optional();
  }

  if (opts.withFragmentBounds) {
    shape['sourceStartMs'] = z.number().int().nonnegative();
    shape['sourceEndMs'] = z.number().int().nonnegative();
  }

  if (opts.withSourceQuote) {
    // Обязательное поле — для аудита; не optional.
    shape['sourceQuote'] = z.string().min(1).max(2000);
  }

  if (opts.withConfidence) {
    // С enforcement: number ∈ [0,1]. ВАЖНО: caller всё равно должен
    // clamp'ить значение перед записью в БД на случай галлюцинации
    // (Decimal(4,3) бросит на 1.0001).
    shape['confidence'] = z.number().min(0).max(1);
  }

  return z.object(shape).strict();
}

/**
 * Динамическая схема-обёртка `{ tasks: TaskItem[] }`. Используется, когда
 * caller ждёт объект (legacy `analyze.worker` через TASKS_SCHEMA,
 * `MeetingExtractActionsService` через TASKS_SCHEMA).
 */
export function buildTasksSchemaUnified(opts: TasksPromptOptions): z.ZodTypeAny {
  // ВАЖНО: legacy экспорт `TasksSchema`/`TaskItemSchema` оставлен в
  // `common.ts` как «широкий» (все поля optional) — это используется
  // для парсинга разных моделей. Здесь же возвращаем «строгую» схему
  // под конкретные опции.
  const item = buildTaskItemSchemaUnified(opts);
  return z.object({ tasks: z.array(item) }).strict();
}

// ─────────────────── LlmTool / JSON-Schema ────────────────────────────────

/**
 * Динамический LlmTool с JSON-Schema под опции. JSON-Schema собирается
 * вручную (как в `common.ts::buildExtractTool`) — `zod-to-json-schema` не
 * используем, чтобы держать минимум зависимостей и иметь полный контроль
 * (Anthropic и DeepSeek требуют строгий объект).
 */
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

  // ТЗ 2026-05-25 — assigneeUserId в JSON Schema. Только когда передан
  // список участников. Поле nullable (не required) — LLM может вернуть null,
  // если исполнитель не зарегистрирован на встрече.
  if (opts.participants && opts.participants.length > 0) {
    taskProperties['assigneeUserId'] = fieldNullableString;
  }

  taskProperties['dueDate'] = fieldNullableString;
  if (!opts.useAssigneeRaw) {
    // В legacy-варианте dueDate был required (хотя и nullable). В
    // structured-пути — optional (нет такого жёсткого контракта).
    taskRequired.push('dueDate');
  }

  if (opts.enriched || lax) {
    // lax-режим — для backward-compat исторического TASKS_TOOL: schema
    // включала suggested*-поля как optional, даже когда enriched-флаг
    // не был выставлен (тогда такого флага не было — был один общий tool).
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

  // sourceQuote — присутствует в schema, если caller просит цитату ИЛИ
  // включён lax-режим (legacy compat). Required только если caller
  // явно просит цитату И не выставил lax.
  if (opts.withSourceQuote || lax) {
    taskProperties['sourceQuote'] = fieldString;
    if (opts.withSourceQuote && !lax && (opts.useAssigneeRaw || opts.enriched)) {
      taskRequired.push('sourceQuote');
    }
  }

  // confidence — аналогично: присутствует в lax-варианте как optional,
  // а в строгом — required (модель обязана вернуть).
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

// ─────────────────── System / User prompt ─────────────────────────────────

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

/**
 * Динамический системный промт. База — «извлеки задачи». Дополнения по опциям:
 *   - `enriched`        → блок про suggested*-поля + контекст организации.
 *   - `withFragmentBounds` → блок про sourceStartMs/EndMs.
 *   - `withSourceQuote` → блок про обязательную цитату.
 *   - `withConfidence`  → инструкция про confidence + helper
 *                         `withConfidenceCalibration` (F2).
 *   - `useAssigneeRaw`  → STRUCTURED_BASE_SYSTEM (assigneeRaw + description).
 *   - `responseAsBareArray` → инструкция «JSON-массив, без обёрток».
 *   - всегда (для tool-use варианта): `withToolInstructions`.
 *   - если есть `roomChat` в input → `withRoomChatNote`.
 */
function buildSystemUnified(
  opts: TasksPromptOptions,
  roomChat: PromptInput['roomChat'],
): string {
  let body = opts.useAssigneeRaw ? STRUCTURED_BASE_SYSTEM : BASE_SYSTEM;

  if (opts.enriched) body += `\n${ENRICHED_FIELDS_BLOCK}`;
  if (opts.withFragmentBounds) body += `\n${FRAGMENT_BOUNDS_BLOCK}`;
  if (opts.withSourceQuote) body += `\n${SOURCE_QUOTE_BLOCK}`;
  if (opts.withConfidence) body += `\n${CONFIDENCE_FIELD_BLOCK}`;
  // ТЗ 2026-05-25 hard-participant-identification: правила про
  // assigneeUserId — только когда передан непустой список participants.
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
    // F2 — единая калибровка шкалы confidence. Применяем В КОНЕЦ — после
    // tool-инструкций и room-chat заметки. Это безопасно: добавка ничего
    // не отменяет, только уточняет шкалу.
    body = withConfidenceCalibration(body);
  }

  return body;
}

/**
 * Собирает user-сообщение. Включает meta встречи + (опционально) контекст
 * организации (проекты, цели, сотрудники) + диалог (через `turnsToText`).
 */
function buildUserUnified(
  input: PromptInput,
  opts: TasksPromptOptions,
): string {
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

  // ТЗ 2026-05-25 hard-participant-identification — компактный блок участников
  // встречи (стабильный userId), отдельно от «Сотрудники организации» (которые
  // могут быть упомянуты в речи, но не быть на встрече).
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

/**
 * Главный публичный builder. Возвращает `{ system, user }` под заданные опции.
 */
export function buildTasksPromptUnified(
  input: PromptInput,
  opts: TasksPromptOptions = {},
): PromptOutput {
  return {
    system: buildSystemUnified(opts, input.roomChat),
    user: buildUserUnified(input, opts),
  };
}

// ─────────────────── re-exports для caller'ов common-схем ─────────────────

/**
 * Общие «широкие» схемы из `common.ts`, которые исторически используются
 * caller'ами для парсинга ответа LLM (TaskItemSchema/TasksSchema — все
 * поля optional, чтобы старые модели проходили валидацию).
 *
 * Если новому caller'у нужна СТРОГАЯ схема под конкретные опции — он
 * должен использовать `buildTasksSchemaUnified(opts)` напрямую.
 */
export { TaskItemSchema, TasksSchema };
