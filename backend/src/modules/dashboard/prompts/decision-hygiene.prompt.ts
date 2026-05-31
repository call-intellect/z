/**
 * Pulse Wave 6 §6.8 — Decision Hygiene Scorer.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.8.
 *
 * Промпт для LLM-классификации каждого нового Decision по Bezos two-way door:
 *   - type-1 = необратимое (large investments, hiring senior, public commitments,
 *              regulatory commitments, public communication, founder hires).
 *   - type-2 = обратимое (pilot, experiment, internal process change, A/B test,
 *              feature toggle).
 *
 * Cache-friendly (см. feedback_llm_prompts_cache_friendly.md):
 *   - SYSTEM полностью статичен — стабильный набор правил и enum'ов;
 *   - переменные данные (statement + alternatives) — В КОНЦЕ user-сообщения;
 *   - префикс user тоже стабилен.
 * Это даёт ~99% prompt cache hit на DeepSeek / OpenAI-proxy.
 *
 * EU AI Act: классификатор работает только над текстом самого решения,
 * без анализа голоса/видео/эмоций спикера.
 */

/**
 * Стабильный системный промпт. Менять только при mass-recompute (ломает кэш
 * провайдера и инвалидирует ранее посчитанные reversibility).
 */
export const DECISION_HYGIENE_SYSTEM_PROMPT = `Ты классифицируешь корпоративные решения по принципу Bezos two-way door.

Type-1 (необратимое) — решение, которое крайне сложно или дорого откатить:
- крупные инвестиции / закупки / контракты,
- найм или увольнение senior-сотрудника,
- публичные обязательства перед клиентами/рынком,
- регуляторные обязательства (152-ФЗ, лицензии),
- запуск продукта на массовый рынок без feature-flag.

Type-2 (обратимое) — решение, которое можно откатить за разумную цену:
- пилот, эксперимент, A/B-тест,
- внутренний процесс / регламент / расписание,
- feature toggle / canary release,
- найм/перевод на испытательный срок,
- выбор инструмента, который не требует миграции данных.

Если решение неоднозначное — отдавай предпочтение type-1 (по правилу Bezos:
«если решение выглядит как одностороннее окно, относись к нему как к
одностороннему»).

Верни СТРОГО JSON:
{
  "reversibility": "type-1" | "type-2",
  "rationale": "1-2 предложения, почему так"
}

Без markdown-fences, без полей кроме перечисленных.`;

/**
 * JSON-schema для `responseFormat: json_schema` (strict). Используется
 * провайдерами, поддерживающими structured output (OpenAI / DeepSeek). Для
 * остальных LlmRouter falls back в plain text + парсер ниже разбирает JSON.
 */
export const DECISION_HYGIENE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reversibility: { type: 'string', enum: ['type-1', 'type-2'] },
    rationale: { type: 'string' },
  },
  required: ['reversibility', 'rationale'],
};

/**
 * Альтернатива решения, как хранится в `Decision.alternatives` (Json массив).
 */
export interface DecisionHygieneAlternative {
  option: string;
  reasonRejected?: string | null;
}

/**
 * Сборка user-сообщения для `decision-hygiene`.
 *
 * Cache-friendly правило: фиксированный заголовок и инструкция — сверху,
 * переменные данные (statement, rationale, alternatives) — внизу JSON-блоком.
 */
export function buildDecisionHygieneUserMessage(args: {
  statement: string;
  rationale?: string | null;
  alternatives?: DecisionHygieneAlternative[] | null;
}): string {
  const payload: Record<string, unknown> = {
    statement: args.statement,
  };
  if (args.rationale && args.rationale.trim().length > 0) {
    payload.rationale = args.rationale;
  }
  if (args.alternatives && args.alternatives.length > 0) {
    payload.alternatives = args.alternatives;
  }
  return [
    `Классифицируй решение ниже как type-1 или type-2 по правилу Bezos.`,
    `Если есть rationale и alternatives — учитывай их (наличие альтернатив`,
    `не означает автоматически type-2; смотри на обратимость).`,
    ``,
    `Данные решения (JSON):`,
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * Тип распарсенного ответа Decision-Hygiene LLM.
 */
export interface DecisionHygieneParsedResponse {
  reversibility: 'type-1' | 'type-2';
  rationale: string;
}

/**
 * Безопасный парсер: возвращает null при невалидном JSON или нарушении схемы.
 * Поддерживает code-fence (```json) на случай если провайдер всё-таки обернул.
 */
export function parseDecisionHygieneResponse(
  text: string,
): DecisionHygieneParsedResponse | null {
  const stripped = stripCodeFence(text);
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/u);
    if (!match) return null;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const reversibility = o.reversibility;
  const rationale = o.rationale;
  if (reversibility !== 'type-1' && reversibility !== 'type-2') return null;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) return null;
  return { reversibility, rationale };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n');
}
