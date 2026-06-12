/**
 * SBA α-7 — Specialist 3.1 (Regulations).
 *
 * LLM-промпт `regulation-extract` — из IdeaBlock с `signalType='regulation'`
 * (или `'process_step'`, или `'policy'`) извлекает структурированный черновик
 * под нужную сущность (Process / Regulation / Policy).
 *
 * Возвращаемый JSON Schema strict — см. `REGULATION_EXTRACT_SCHEMA`. На входе
 * — текст блока (criticalQuestion + trustedAnswer + теги + цитаты).
 *
 * Цель: 1 блок → 1 черновик карточки, в краткой и последовательной форме.
 */

import {
  EXTRACTION_STATUS_RU,
  withAsrNote,
  withConfidenceCalibration,
  withEdgeCasePolicy,
  withExtractedNotConfirmedNote,
} from '../../ai/services/prompts/common';

export const REGULATION_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
  withExtractedNotConfirmedNote(
  withConfidenceCalibration(
    [
    'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором упомянут регламент / процесс / политика / инструкция компании.',
    'Твоя задача — извлечь структурированный черновик нужной сущности на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
    'Не выдумывай факты вне блока. Если в блоке нет нужного поля — оставь его null.',
    '',
    'Различай:',
    '- regulation — формальное правило / норматив компании (например, «все договоры с подрядчиком должны проходить юр.проверку»).',
    '- process — последовательность шагов СКВОЗЬ несколько ролей / этапов (например, «онбординг клиента»: продажи → юрист → внедрение).',
    '- instruction — пошаговое «как сделать X» для ОДНОЙ роли (single-role): инструкция исполнителю одной должности, как именно выполнить операцию (например, «как менеджеру оформить возврат в 1С»). Признак instruction: все шаги выполняет один человек/роль, нет передачи работы между ролями. Если работа передаётся между ролями — это process, не instruction.',
    '- policy — политика с уровнем строгости (рекомендация / обязательная / критическая) — например, политика отпусков.',
    '- standard — внешний стандарт (например, ISO 9001), на который ссылается регламент.',
    'И regulation/process/instruction ≠ разовая задача на эту встречу — извлекай только повторяемую норму («как делаем всегда»), а не одноразовое поручение.',
    '',
    'Если блок описывает шаг процесса, верни kind="process" и заполни поле processStepHint.',
    'Если блок описывает инструкцию для одной роли, верни kind="instruction" и заполни roles (затронутая роль/роли).',
    '',
    `extractionStatus — статус существования документа, одно из: ${EXTRACTION_STATUS_RU.join(' | ')} (правило ниже).`,
    'roles — список ролей/должностей, которых касается норма (для instruction — это исполнитель; для process — все участники цепочки). Пустой массив, если роли не названы.',
    'evidenceQuote — дословная опора из блока (≤15-20 слов), подтверждающая извлечение. Если точной цитаты нет — null.',
    '',
    'Чего НЕ извлекать как орг-документ:',
    '- чужие практики (как делают у конкурентов / в Google / «в больших компаниях») — это не регламент компании;',
    '- гипотетику («если бы сделать как…», «можно было бы») — это не действующая норма;',
    '- голое упоминание документа без его содержания: если документ лишь упомянут (есть, но что в нём — не раскрыто), это existence-сигнал с НИЗКИМ confidence — тело не извлекай.',
    'Калибровка confidence: есть шаги / роли / сроки → 0.9; только голое упоминание документа → 0.5.',
    '',
    'isOrgNorm — повторяемая норма/инструкция/политика КОМПАНИИ («как делаем всегда») → true; чужая практика, гипотетика, разовое поручение или голое упоминание без содержания → false. На false остальные поля можно вернуть пустыми, confidence низкий.',
    '',
    'ПРИМЕРЫ.',
    '',
    'Положительный — regulation (взаимодействие ролей + срок):',
    'Блок «Проверка договоров» (signalType=regulation). Цитаты: «Все договоры с подрядчиком сначала уходят юристу на проверку, юрист отвечает в течение 3 рабочих дней».',
    'Вывод: {"kind":"regulation","name":"Юридическая проверка договоров с подрядчиками","statement":"Каждый договор с подрядчиком проходит юридическую проверку до подписания; юрист отвечает в течение 3 рабочих дней.","extractionStatus":"существует","roles":["юрист","менеджер"],"evidenceQuote":"договоры с подрядчиком сначала уходят юристу на проверку","scope":"org","ownerHint":"юрист","severity":null,"category":"regulation","processStepHint":null,"isOrgNorm":true,"confidence":0.9}.',
    '',
    'Положительный — instruction (одна роль, без передачи между ролями):',
    'Блок «Возврат в 1С» (signalType=process_step). Цитаты: «Менеджер оформляет возврат в 1С: открыть заказ, создать возврат, провести документ».',
    'Вывод: {"kind":"instruction","name":"Как менеджеру оформить возврат в 1С","statement":"Менеджер оформляет возврат в 1С: открыть заказ → создать возврат → провести документ.","extractionStatus":"существует","roles":["менеджер"],"evidenceQuote":"Менеджер оформляет возврат в 1С: открыть заказ, создать возврат, провести","scope":"role:менеджер","ownerHint":"менеджер","severity":null,"category":null,"processStepHint":null,"isOrgNorm":true,"confidence":0.88}.',
    '',
    'Что НЕ извлекать (edge case — чужая практика + гипотетика):',
    'Блок «Онбординг как в Google» (signalType=regulation). Цитаты: «Хорошо бы когда-нибудь описать онбординг так, как это делают в Google».',
    'Вывод: {"kind":"regulation","name":"Онбординг по образцу Google (не норма)","statement":"Недостаточно сигнала: упомянута чужая практика и гипотетика, это не действующая норма компании.","extractionStatus":null,"roles":[],"evidenceQuote":null,"scope":null,"ownerHint":null,"severity":null,"category":null,"processStepHint":null,"isOrgNorm":false,"confidence":0.15}. Пояснение: «как в Google» — чужая практика, «хорошо бы когда-нибудь» — гипотетика; не повторяемая норма компании → тело не извлекаем, confidence низкий.',
    ].join('\n'),
  ),
  ),
  ),
);

export const REGULATION_EXTRACT_USER_TEMPLATE = (args: {
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
    'Верни JSON-объект по схеме `regulation_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `regulation-extract`. Поддерживается DeepSeek V4 и
 * OpenAI Responses API; Ollama (qwen3) фоллбэк падает с
 * `LlmFormatNotSupportedError` — роутер переходит к secondary/primary.
 */
export const REGULATION_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'statement', 'isOrgNorm', 'confidence'],
  properties: {
    kind: {
      type: 'string',
      enum: ['regulation', 'process', 'policy', 'standard', 'instruction'],
    },
    name: { type: 'string', minLength: 3, maxLength: 300 },
    statement: { type: 'string', minLength: 5, maxLength: 4_000 },
    extractionStatus: {
      type: ['string', 'null'],
      enum: [null, 'существует', 'нужен', 'обсуждается'],
      description:
        'Статус существования документа: «существует» (есть и действует) | «нужен» (заявлена потребность) | «обсуждается» (не финализирован).',
    },
    roles: {
      type: 'array',
      items: { type: 'string', maxLength: 200 },
      description:
        'Роли/должности, которых касается норма. Для instruction — исполнитель (одна роль); для process — все участники цепочки.',
    },
    evidenceQuote: {
      type: ['string', 'null'],
      maxLength: 400,
      description: 'Дословная опора из блока (≤15-20 слов), подтверждающая извлечение.',
    },
    scope: {
      type: ['string', 'null'],
      description:
        "'org' | 'department:<id>' | 'role:<id>' | 'project:<id>' — кому регламент адресован",
    },
    ownerHint: {
      type: ['string', 'null'],
      maxLength: 300,
      description: 'Текстовая подсказка про ответственного (имя/роль).',
    },
    severity: {
      type: ['string', 'null'],
      enum: [null, 'advisory', 'mandatory', 'blocking'],
      description: 'Только для kind=policy.',
    },
    category: {
      type: ['string', 'null'],
      enum: [null, 'regulation', 'standard'],
      description: 'Только для kind=regulation/standard.',
    },
    processStepHint: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        processName: { type: 'string', minLength: 2, maxLength: 300 },
        stepName: { type: 'string', minLength: 2, maxLength: 300 },
        stepOrder: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
        stepDescription: { type: ['string', 'null'], maxLength: 2_000 },
      },
      required: ['processName', 'stepName'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    isOrgNorm: {
      type: 'boolean',
      description:
        'true — фрагмент описывает повторяемую норму/инструкцию/политику КОМПАНИИ («как делаем всегда»); false — чужая практика, гипотетика, разовое поручение или голое упоминание без содержания. На false тело можно вернуть пустым, confidence низкий.',
    },
  },
};

export const REGULATION_EXTRACT_SCHEMA_NAME = 'regulation_extract_v1';
