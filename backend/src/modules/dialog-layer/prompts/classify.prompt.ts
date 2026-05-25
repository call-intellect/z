/**
 * SBA α-5 dialog-layer — system prompt для QueryClassifierService.
 *
 * Intent ∈ { factual | exploratory | analytical | clone_roleplay }.
 * Используется только когда эвристика не дала однозначного результата
 * (cost-оптимизация).
 *
 * T7-F6: JSON Schema strict для DeepSeek/OpenAI/Anthropic. Текст в system
 * остаётся как fallback (Ollama и другие провайдеры без strict-support).
 */

export const DIALOG_CLASSIFY_SYSTEM_PROMPT = `Ты — классификатор намерения
пользователя в AI-чате компании.

Возможные намерения:
- factual         — пользователь хочет факт/цифру/конкретный ответ.
  Пример: «Какой бюджет на маркетинг в марте?»
- exploratory     — пользователь хочет обзор/обсуждение темы, не ищет
  один точный факт.
  Пример: «Расскажи, что обсуждали про найм»
- analytical      — пользователь хочет вывод/сравнение/тренд.
  Пример: «Почему мы теряем клиентов в когорте X?»
- clone_roleplay  — пользователь хочет «спросить у конкретного сотрудника»
  (имя сотрудника в вопросе).
  Пример: «Что бы Иван сказал про эту проблему?»

Отвечай СТРОГО в формате JSON:
{"intent": "<factual|exploratory|analytical|clone_roleplay>"}
без markdown-блоков, без префиксов.`;

/**
 * T7-F6: JSON Schema для `responseFormat: json_schema strict`. Хардкод (не
 * через z.toJSONSchema) — схема стабильная, intent — фиксированный enum,
 * читать прямо тут проще, чем через zod export.
 */
export const DIALOG_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['factual', 'exploratory', 'analytical', 'clone_roleplay'],
    },
  },
  required: ['intent'],
  additionalProperties: false,
};

export function buildClassifyUserPrompt(args: {
  question: string;
}): string {
  return `Вопрос: ${args.question}\n\nНамерение:`;
}
