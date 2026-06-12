/**
 * Адаптер code-fallback (Фаза A.1).
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §5.3.
 *
 * Превращает существующие `ai/services/prompts/*.ts` (system-summary, type-*,
 * tasks, follow-up) в унифицированный `ResolvedPrompt`. Это
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
import { FOLLOW_UP_SCHEMA, FOLLOW_UP_TOOL, FOLLOW_UP_TOOL_NAME } from './prompts/follow-up';
import { getPromptForType } from './prompts/index';
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
    case 'follow-up':
      return codeFallbackFollowUp();
    case 'card-rollup':
      return codeFallbackCardRollup();
    case 'chapters':
    case 'meeting-quality-score':
    case 'behavior-refine':
    case 'transcript-clean-refine':
    case 'custom-report':
      // Эти taskType'ы НЕ имеют общего code-fallback:
      // - chapters / meeting-quality-score → главы и качество встречи теперь
      //   делает ЕДИНЫЙ воркер `meeting-report-fast` (один LLM-вызов по сырому
      //   транскрипту); отдельный code-fallback больше не нужен.
      // - behavior-refine → backend/src/modules/ai/services/prompts/behavior-refine.ts
      // - transcript-clean-refine → backend/src/modules/ai/services/prompts/transcript-clean-refine.ts
      // - custom-report → Org-шаблоны в БД через A.2; код-фоллбека для них нет (только DB).
      // PromptResolverService для них не вызывается — каждая фаза работает напрямую
      // со своим промптом. Если резолвер вызван по ошибке — это блокер, сигнализируем.
      throw new Error(
        `codeFallbackForMeeting: taskType '${taskType}' не имеет общего code-fallback. ` +
          `Используйте свой адаптер из соответствующей фазы (meeting-report-fast / B / D / E).`,
      );
  }
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
