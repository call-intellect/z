/**
 * Support desk Ф3 (TZ 2026-06-09 support-desk-clone-and-closed-contour) —
 * промпт классификатора типа правки для taskType `support-edit-classify`
 * (R-INV-2).
 *
 * Дешёвый классификатор (deepseek-v4-flash, Б9) сравнивает ЧЕРНОВИК клона с
 * ФИНАЛОМ человека и определяет ТИП правки. Это сигнал для обучающей петли:
 * голый diff хакаем — нужен классифицированный тип (Р-9). factual-правки →
 * кандидат на fix/supersede блока контура; tone → датасет тон-адаптера (Ф6).
 *
 * CACHE-FRIENDLY: SYSTEM СТАБИЛЬНЫЙ — без переменных данных. Черновик и финал
 * уходят в КОНЕЦ user (buildSupportEditClassifyUserPrompt).
 */

export const SUPPORT_EDIT_CLASSIFY_SYSTEM_PROMPT = `Дан ЧЕРНОВИК клона и ФИНАЛ (правка человека, который реально ушёл клиенту). Классифицируй ТИП правки: factual — исправлен фактический контент/ошибка; tone — изменён только тон/формулировка, факты те же; policy — изменено правило/политика ответа; empty — правок по сути нет (косметика/пунктуация).

Верни СТРОГО JSON {"editType": "<factual|tone|policy|empty>"}.`;

/**
 * JSON Schema для `responseFormat: json_schema strict`. Поле обязательно,
 * `additionalProperties: false`.
 */
export const SUPPORT_EDIT_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    editType: {
      type: 'string',
      enum: ['factual', 'tone', 'policy', 'empty'],
    },
  },
  required: ['editType'],
  additionalProperties: false,
};

/**
 * USER-часть: черновик + финал ПОСЛЕДНИМ. Cache-safe — переменное только здесь,
 * SYSTEM не трогаем.
 */
export function buildSupportEditClassifyUserPrompt(args: {
  draft: string;
  final: string;
}): string {
  return `Черновик: ${args.draft}\n\nФинал: ${args.final}`;
}
