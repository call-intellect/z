/**
 * Адаптер code-fallback (Фаза A.1).
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §5.3.
 *
 * Превращает существующие `ai/services/prompts/*.ts` (system-summary, type-*,
 * tasks, follow-up, chapters) в унифицированный `ResolvedPrompt`. Это
 * используется PromptResolverService, когда в БД ничего не найдено или
 * на любую ошибку резолва.
 *
 * ВАЖНО: файлы `ai/services/prompts/*.ts` НЕ удаляются — они становятся
 * fallback-источником. Любое изменение в них должно сопровождаться обновлением
 * seed-скрипта `seed-prompt-templates.ts`, иначе db-шаблоны и code-fallback
 * разъедутся.
 */

import type { MeetingType } from '@prisma/client';

import type {
  PromptResolverTaskType,
  ResolvedPrompt,
  ResolvedPromptSection,
} from './prompt-resolver.types';
import { CHAPTERS_TASK_TYPE } from './prompts/chapters';
import { FOLLOW_UP_SCHEMA, FOLLOW_UP_TOOL, FOLLOW_UP_TOOL_NAME } from './prompts/follow-up';
import { getPromptForType } from './prompts/index';
import {
  MEETING_QUALITY_SCORE_INPUT_SCHEMA,
  MEETING_QUALITY_SCORE_SYSTEM_PROMPT,
  MEETING_QUALITY_SCORE_TOOL,
  MEETING_QUALITY_SCORE_TOOL_NAME,
} from './prompts/meeting-quality-score';
import { SUMMARY_TOOL_NAME } from './prompts/system-summary';
import { TASKS_TOOL, TASKS_TOOL_NAME } from './prompts/tasks';

/** Type-helper для безопасного приведения LlmTool.input_schema. */
function castSchema(input: unknown): ResolvedPrompt['outputSchema'] {
  const schema = input as ResolvedPrompt['outputSchema'];
  return {
    type: 'object',
    properties: schema.properties ?? {},
    required: schema.required,
    additionalProperties: schema.additionalProperties,
  };
}

/**
 * Превращает JSON-schema-объект секций в плоский список ResolvedPromptSection.
 * outputType определяется грубо: array → bullet_list, object → json_object,
 * иначе text. Для UI это нормально (превью), а для LLM это всё равно
 * только индикатор — реальная схема ответа берётся из `outputSchema`.
 */
function sectionsFromSchema(
  schema: ResolvedPrompt['outputSchema'],
): ResolvedPromptSection[] {
  const required = new Set(schema.required ?? []);
  const props = schema.properties as Record<string, { type?: string | string[]; description?: string }>;
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

/**
 * code-fallback для summary по типу встречи. Использует `getPromptForType(type)`
 * из существующего `prompts/index.ts`. Тип встречи известен — это основной
 * вызов analyze.worker'а при пустой БД.
 */
function codeFallbackSummary(type: MeetingType): ResolvedPrompt {
  const descriptor = getPromptForType(type);
  // Извлекаем system из buildPrompt с пустым input. Это рабочий хак: buildPrompt
  // встраивает только title встречи в user; system при пустом roomChat
  // идентичен историческому. Точный текст system'а нужен для side-by-side теста.
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

/**
 * code-fallback для system-summary (короткое саммари 2-3 предложения).
 * Системный плейн-текстовый промпт без tool_use.
 */
function codeFallbackPlainSummary(): ResolvedPrompt {
  // Прямо тянуть SUMMARY_SYSTEM из приватного файла было бы хрупко — поэтому
  // используем тот же подход, что и для остальных: вытягиваем system через
  // buildSummaryPrompt с пустым входом.
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
        instruction: 'Сделай связный текст из 2-3 предложений: о чём была встреча, ключевые договорённости.',
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

/** code-fallback для tasks (универсальный, не зависит от типа встречи). */
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

/** code-fallback для chapters. */
function codeFallbackChapters(): ResolvedPrompt {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildChaptersPrompt } = require('./prompts/chapters');
  const dummy = (buildChaptersPrompt as (input: unknown) => { system: string; user: string })({
    meeting: { id: '__cf__', title: '__cf__', type: 'team' },
    dialog: [],
  });
  // chapters использует responseFormat='json' без tool_use — outputSchema плоская.
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: dummy.system,
    toolName: null,
    sections: [
      {
        key: 'chapters',
        title: 'Главы',
        instruction:
          'Разбей встречу на 3-12 смысловых глав. Для каждой — startMs, endMs, title (3-8 слов), summary (1-2 предложения или null), order.',
        outputType: 'json_object',
        required: true,
      },
    ],
    outputSchema: {
      type: 'object',
      properties: {
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startMs: { type: 'integer' },
              endMs: { type: 'integer' },
              title: { type: 'string' },
              summary: { type: ['string', 'null'] },
              order: { type: 'integer' },
            },
            required: ['startMs', 'endMs', 'title', 'order'],
          },
        },
      },
      required: ['chapters'],
    },
  };
}

/** code-fallback для follow-up. */
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

/**
 * code-fallback для card-rollup. Системный текстовый промпт. Зависимость от
 * `kind` карточки не вытаскиваем сюда — это деталь рантайма, оставим
 * card-rollup-worker'у. PromptResolver вернёт «универсальный» промпт; voor
 * детального выбора kind — следующая итерация.
 */
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

/**
 * Главная точка входа адаптера. Возвращает `ResolvedPrompt` для пары
 * (meetingType, taskType). Используется PromptResolverService как
 * последний шаг резолва.
 *
 * Воркер аналайза вызывает этот адаптер косвенно: он спрашивает
 * `PromptResolverService.resolveForMeeting`, тот при пустой/упавшей БД
 * возвращает результат `codeFallbackForMeeting`.
 */
export function codeFallbackForMeeting(
  meetingType: MeetingType,
  taskType: PromptResolverTaskType,
): ResolvedPrompt {
  switch (taskType) {
    case 'summary':
      // Для analyze.worker'а «summary» — это structured-отчёт по типу встречи.
      // Короткий plain-text summary живёт отдельно (system-summary.ts) и
      // вызывается перед structured. Возвращаем structured-фаллбек.
      return codeFallbackSummary(meetingType);
    case 'tasks':
      return codeFallbackTasks();
    case 'chapters':
      return codeFallbackChapters();
    case 'follow-up':
      return codeFallbackFollowUp();
    case 'card-rollup':
      return codeFallbackCardRollup();
    case 'meeting-quality-score':
      return codeFallbackMeetingQualityScore();
    case 'behavior-refine':
    case 'transcript-clean-refine':
    case 'custom-report':
      // Эти taskType'ы используют собственный code-fallback (Фазы B/D/E):
      // - behavior-refine → backend/src/modules/ai/services/prompts/behavior-refine.ts
      // - transcript-clean-refine → backend/src/modules/ai/services/prompts/transcript-clean-refine.ts
      // - custom-report → Org-шаблоны в БД через A.2; код-фоллбека для них нет (только DB).
      // PromptResolverService для них не вызывается — каждая фаза работает напрямую
      // со своим промптом. Если резолвер вызван по ошибке — это блокер, сигнализируем.
      throw new Error(
        `codeFallbackForMeeting: taskType '${taskType}' не имеет общего code-fallback. ` +
          `Используйте свой адаптер из соответствующей фазы (B/D/E).`,
      );
  }
}

/**
 * Фаза C — code-fallback для `meeting-quality-score` (sub-TZ C §5).
 * Системный промпт — `MEETING_QUALITY_SCORE_SYSTEM_PROMPT`, tool —
 * `MEETING_QUALITY_SCORE_TOOL`. UI-секции выводим простым списком,
 * соответствующим 5 категориям + блокам recommendations / strengths
 * (для будущего UI-редактора в /admin/prompts).
 */
function codeFallbackMeetingQualityScore(): ResolvedPrompt {
  const schema: ResolvedPrompt['outputSchema'] = {
    type: 'object',
    properties: MEETING_QUALITY_SCORE_INPUT_SCHEMA.properties,
    ...(MEETING_QUALITY_SCORE_INPUT_SCHEMA.required
      ? { required: MEETING_QUALITY_SCORE_INPUT_SCHEMA.required }
      : {}),
    ...(MEETING_QUALITY_SCORE_INPUT_SCHEMA.additionalProperties !== undefined
      ? { additionalProperties: MEETING_QUALITY_SCORE_INPUT_SCHEMA.additionalProperties }
      : {}),
  };
  return {
    source: 'code_fallback',
    versionId: null,
    systemPrompt: MEETING_QUALITY_SCORE_SYSTEM_PROMPT,
    toolName: MEETING_QUALITY_SCORE_TOOL_NAME,
    toolDescription: MEETING_QUALITY_SCORE_TOOL.description,
    sections: [
      {
        key: 'overallScore',
        title: 'Общий балл',
        instruction: 'Взвешенное среднее категорий, 0..100.',
        outputType: 'text',
        required: true,
      },
      {
        key: 'categories',
        title: '5 категорий (0..100)',
        instruction:
          'Оцени preparation / structure / clarity / outcomes / engagement, целые от 0 до 100.',
        outputType: 'json_object',
        required: true,
      },
      {
        key: 'recommendations',
        title: 'Рекомендации',
        instruction:
          '3–7 пунктов «как сделать встречу лучше»: { text, severity, category }. Тон конструктивный.',
        outputType: 'bullet_list',
        required: true,
      },
      {
        key: 'strengths',
        title: 'Что было хорошо',
        instruction: '2–4 пункта того, что было хорошо.',
        outputType: 'bullet_list',
        required: true,
      },
    ],
    outputSchema: schema,
  };
}

/**
 * Отдельная точка для plain-text summary (2-3 предложения), которая в
 * analyze.worker'е вызывается ВСЕГДА перед structured-отчётом. ТЗ A.1 не
 * требует резолвить её через БД — но мы заранее заводим её под единый
 * контракт, чтобы analyze.worker мог запросить её через PromptResolver.
 */
export function codeFallbackPlainSummaryPublic(): ResolvedPrompt {
  return codeFallbackPlainSummary();
}

// Подавляем неиспользуемые имена.
void CHAPTERS_TASK_TYPE;
