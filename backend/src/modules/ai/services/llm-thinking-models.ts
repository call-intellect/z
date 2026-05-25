/**
 * ТЗ 2026-05-25 (llm-architecture-changes-from-experiments, §4 + §10.4 Find 3) —
 * детектор thinking-моделей DeepSeek / OpenAI, у которых thinking-режим
 * не поддерживает часть параметров OpenAI Chat Completions API:
 *
 *   - `response_format: { type: 'json_schema', strict: true }` → 400.
 *   - `tool_choice: 'required'` → 400 «Thinking mode does not support…».
 *   - `tool_choice: { type: 'function', function: { name } }` (forced) → 400.
 *
 * Эмпирически проверено в `backend/scripts/eval/probe-deepseek-formats.ts`
 * (8 комбинаций, 4 падают). Полный отчёт — `plans/tz/2026-05-25-deepseek-pro-output-format-fix.md`.
 *
 * Эвристика по имени модели:
 *   - `deepseek-v4-pro` / `deepseek-pro` / любая модель, содержащая «pro».
 *   - `flash-thinking` / `*-thinking-*` — будущие thinking-варианты flash.
 *
 * Использовать в `DeepSeekService.buildParams` и
 * `OpenAiChatProtocolAdapter.complete` для автозамены:
 *   strict json_schema → tools + tool_choice='auto' + hint в user.
 *
 * `isThinkingModel('deepseek-v4-flash') === false` — flash без thinking
 *   поддерживает все режимы.
 * `isThinkingModel('gpt-5.4-mini') === false` — OpenAI Responses API
 *   не вызывается через этот эвристический детектор (там свой путь
 *   через `OpenAiProxyService.responses.create`, который сам справляется).
 */
export function isThinkingModel(model: string | undefined | null): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  if (lower.includes('pro')) return true;
  // На случай будущих flash-thinking вариантов — например, `deepseek-v4-flash-thinking`.
  if (lower.includes('thinking')) return true;
  return false;
}

/**
 * Описание автозамены для логов / метрик.
 *
 *  - `strict-stripped` — на thinking-модели был tools + json_schema strict;
 *    json_schema снят (оставлены только tools).
 *  - `schema-to-tool` — был только json_schema; завернули в synthetic tool
 *    + tool_choice='auto' + hint в user.
 *  - `tool-choice-relaxed` — caller передал forced tool_choice (required /
 *    forced function), снимаем до 'auto'. Сейчас в коде такого пути нет
 *    (DeepSeekService / адаптеры жёстко ставят 'auto'), но защита на будущее.
 */
export type LlmThinkingGuardKind =
  | 'strict-stripped'
  | 'schema-to-tool'
  | 'tool-choice-relaxed';
