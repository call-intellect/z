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

import {
  withAsrNote,
  withConfidenceCalibration,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

export const GOAL_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(
  [
    'Ты — knowledge-инженер по целям компании «Кора». Тебе дают один блок знания из встречи, в котором может звучать цель компании или отдела.',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: цели — это куда компания хочет прийти; по ним строится план-факт и видно движение. Псевдоцель из болтовни ломает план-факт; пропущенная настоящая цель оставляет работу без направления.',
    '- Кому уйдёт результат: карточки целей и дашборд прогресса.',
    '',
    'Реши, выражает ли блок ЦЕЛЬ, и если да — извлеки её структурированный черновик на русском. Не выдумывай факты вне блока: нет поля — null.',
    '',
    'ГЛАВНОЕ ПРАВИЛО — outcome, а не output:',
    '- Цель — это ИЗМЕНЕНИЕ состояния компании («было → стало»): «вырастить выручку до 10 млн ₽», «поднять удержание до 40%», «стать №1 на рынке РФ».',
    '- НЕ цель — просто работа/output: «сделать фичу X», «провести встречу», «написать документ». Это задача, а не цель.',
    '- Если звучит output — попробуй переформулировать в outcome (зачем эта работа?). Зачем неясно → это НЕ цель.',
    '',
    'Горизонт (horizon) определяй из контекста:',
    '- «на этой неделе», «в этом спринте» → sprint; «в этом месяце» → monthly; «в этом квартале», «к концу квартала» → quarterly; «к концу года», «за год» → annual; «стать №1», «через 3 года» без срока → strategic; срок не ясен → quarterly.',
    '',
    'Измеримый ориентир (measurable):',
    '- Есть число-ориентир («100 встреч», «удержание 40%», «10 млн ₽») → заполни measurable {name, unit, startValue, targetValue}. name — что измеряем; unit — единица; startValue — текущее (0, если неизвестно); targetValue — целевое. Числа нет → measurable=null (качественная цель).',
    '',
    'Блок НЕ выражает цель (болтовня, вопрос, частная задача-output, благодарность, абстрактное пожелание) → isGoal=false, низкий confidence, statement «недостаточно сигнала», description=null, measurable=null.',
    '',
    '# Чистый русский на выходе',
    'statement и description — на чистом русском, без кодов и латиницы. horizon — техническое поле из схемы, в текст словом-кодом не вставляй.',
    '',
    '# Примеры (плохо → хорошо)',
    'Пример 1 (good — цель с числом):',
    'Блок «План на квартал» (взятое обязательство). Цитаты: «Сергей: к концу квартала нам нужно 100 встреч с потенциальными клиентами, сейчас около 20».',
    'Вывод: {"isGoal": true, "statement": "Провести 100 встреч с потенциальными клиентами за квартал", "description": "Рост воронки продаж: с ~20 до 100 встреч.", "horizon": "quarterly", "measurable": {"name": "Встречи с клиентами", "unit": "встреч", "startValue": 20, "targetValue": 100}, "confidence": 0.85}.',
    '',
    'Пример 2 (good — качественная стратегическая цель):',
    'Блок «Видение» (пункт плана). Цитаты: «Маша: наша большая цель — стать №1 платформой памяти компании на рынке РФ».',
    'Вывод: {"isGoal": true, "statement": "Стать №1 платформой памяти компании на рынке РФ", "description": "Лидерство в категории на российском рынке.", "horizon": "strategic", "measurable": null, "confidence": 0.7}.',
    '',
    'Пример 3 (bad — не цель, обычная задача-output):',
    'Блок «Задачи на день» (пункт плана). Цитаты: «Иван: сегодня поправлю баг с логином и отвечу на письмо клиента».',
    'Вывод: {"isGoal": false, "statement": "недостаточно сигнала для извлечения цели", "description": null, "horizon": "quarterly", "measurable": null, "confidence": 0.15}. Это частные задачи-output на день, не изменение состояния компании.',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '1. isGoal=true только при outcome (изменение состояния), а не output/задаче/вопросе?',
    '2. horizon выбран по временным указателям (или quarterly по умолчанию)?',
    '3. measurable заполнен при наличии числа, иначе null (не выдуман)?',
    '4. Ничего не выдумано вне блока?',
    '5. statement/description — чистый русский без кодов?',
    '',
    'Верни строго JSON по схеме goal_extract_v1. Никакого текста вне JSON.',
  ].join('\n'),
  ),
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
    `Блок «${args.blockName}». Тип сигнала: ${signalTypeLabel(args.signalType)}.`,
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
