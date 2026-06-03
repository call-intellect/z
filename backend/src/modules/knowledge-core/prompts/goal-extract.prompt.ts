/**
 * Goals OKR v2 (2026-06-02, Фаза 2) — Specialist 3-14 (Goals).
 *
 * LLM-промпт `goal-extract` — из одного IdeaBlock встречи (signalType ∈
 * { 'commitment', 'plan_item' }) извлекает структурированный черновик ЦЕЛИ
 * компании (Goal). Главное правило (урок анализа §3А.2 / §8 ТЗ): предпочитать
 * outcome-формулировку (изменение «было→стало», «вырастить retention до 40%»),
 * а НЕ output («сделать фичу X», «провести встречу»).
 *
 * Промпт ОБЯЗАН уметь вернуть «не цель» (`isGoal=false` + низкий confidence) —
 * анти-плодёж псевдоцелей из болтовни, вопросов и частных задач.
 *
 * Cache-friendly (memory `feedback_llm_prompts_cache_friendly`): SYSTEM
 * стабилен, переменные данные (имя блока, цитаты, теги) — в конце USER.
 */

import { withConfidenceCalibration } from '../../ai/services/prompts/common';

export const GOAL_EXTRACT_SYSTEM_PROMPT = withConfidenceCalibration(
  [
    'Ты — knowledge-инженер по целям компании. Тебе дают один IdeaBlock из встречи, в котором может звучать цель компании / отдела.',
    'Твоя задача — решить, выражает ли блок ЦЕЛЬ, и если да — извлечь её структурированный черновик на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
    'Не выдумывай факты вне блока. Если поля нет — оставь его null.',
    '',
    'ГЛАВНОЕ ПРАВИЛО — outcome, а не output:',
    '- Цель — это ИЗМЕНЕНИЕ состояния компании («было → стало»): «вырастить выручку до 10 млн ₽», «поднять retention до 40%», «стать №1 на рынке РФ».',
    '- НЕ цель — это просто работа / output: «сделать фичу X», «провести встречу», «написать документ». Это задача (output), а не цель (outcome).',
    '- Если в блоке звучит output — попробуй переформулировать в outcome (зачем эта работа?). Если зачем неясно — это НЕ цель.',
    '',
    'Горизонт (`horizon`) определяй из контекста:',
    '- «на этой неделе», «в этом спринте», «к концу спринта» → sprint.',
    '- «в этом месяце», «за месяц» → monthly.',
    '- «в этом квартале», «за квартал», «к концу квартала» → quarterly.',
    '- «к концу года», «в этом году», «за год» → annual.',
    '- «стать №1», «занять рынок», «через 3 года» без явного срока → strategic.',
    '- Если срок не ясен — по умолчанию quarterly (типичная цель компании).',
    '',
    'Измеримый ориентир (`measurable`):',
    '- Если в блоке есть число-ориентир («100 встреч», «retention 40%», «10 млн ₽») — заполни measurable {name, unit, startValue, targetValue}.',
    '- name — что измеряем («Встречи с клиентами», «Retention», «Выручка»).',
    '- unit — единица («встреч», «%», «₽»). startValue — текущее значение (0, если неизвестно). targetValue — целевое число.',
    '- Если числа нет — measurable=null (качественная цель без KR).',
    '',
    'Если блок НЕ выражает цель (болтовня, вопрос, частная задача-output, благодарность, абстрактное пожелание):',
    '- верни isGoal=false, низкий confidence, statement — короткое «недостаточно сигнала», description=null, measurable=null.',
    '',
    'ПРИМЕРЫ.',
    '',
    'Пример 1 (good — цель с числом):',
    'Блок «План на квартал» (commitment). Цитаты: «Сергей: к концу квартала нам нужно 100 встреч с потенциальными клиентами, сейчас около 20».',
    'Вывод: {"isGoal": true, "statement": "Провести 100 встреч с потенциальными клиентами за квартал", "description": "Рост воронки продаж: с ~20 до 100 встреч.", "horizon": "quarterly", "measurable": {"name": "Встречи с клиентами", "unit": "встреч", "startValue": 20, "targetValue": 100}, "confidence": 0.85}.',
    '',
    'Пример 2 (good — качественная стратегическая цель):',
    'Блок «Видение» (plan_item). Цитаты: «Маша: наша большая цель — стать №1 платформой памяти компании на рынке РФ».',
    'Вывод: {"isGoal": true, "statement": "Стать №1 платформой памяти компании на рынке РФ", "description": "Лидерство в категории на российском рынке.", "horizon": "strategic", "measurable": null, "confidence": 0.7}.',
    '',
    'Пример 3 (bad — не цель, обычная задача-output):',
    'Блок «Задачи на день» (plan_item). Цитаты: «Иван: сегодня поправлю баг с логином и отвечу на письмо клиента».',
    'Вывод: {"isGoal": false, "statement": "недостаточно сигнала для извлечения цели", "description": null, "horizon": "quarterly", "measurable": null, "confidence": 0.15}. Пояснение: это частные задачи-output на день, не изменение состояния компании.',
  ].join('\n'),
);

export const GOAL_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}» (signalType=${args.signalType}).`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    'Верни JSON-объект по схеме `goal_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `goal-extract`. Поддерживается DeepSeek V4 и OpenAI
 * Responses API; Ollama (qwen3) fallback падает с `LlmFormatNotSupportedError` —
 * роутер переходит к secondary/tertiary.
 */
export const GOAL_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['isGoal', 'statement', 'horizon', 'confidence'],
  properties: {
    isGoal: {
      type: 'boolean',
      description: 'Выражает ли блок цель компании. false — болтовня/вопрос/задача-output.',
    },
    statement: {
      type: 'string',
      minLength: 3,
      maxLength: 2_000,
      description: 'Название цели (outcome). При isGoal=false — короткое «недостаточно сигнала».',
    },
    description: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Развёрнутое описание цели (контекст «было→стало»). null если нет.',
    },
    horizon: {
      type: 'string',
      enum: ['strategic', 'annual', 'quarterly', 'monthly', 'sprint'],
      description: 'Горизонт цели. По умолчанию quarterly.',
    },
    measurable: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'startValue', 'targetValue'],
      description: 'Измеримый ориентир (KR) или null, если числа в блоке нет.',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 300 },
        unit: { type: ['string', 'null'], maxLength: 100 },
        startValue: { type: 'number' },
        targetValue: { type: 'number' },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const GOAL_EXTRACT_SCHEMA_NAME = 'goal_extract_v1';
