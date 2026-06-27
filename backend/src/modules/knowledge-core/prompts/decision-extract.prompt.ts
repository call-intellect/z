/**
 * SBA β-3 — Specialist 3.3 (Decisions Registry).
 *
 * LLM-промпт `decision-extract` — из IdeaBlock с
 * `signalType ∈ { 'decision', 'rationale', 'decision_basis' }` извлекает
 * структурированный черновик решения (Decision).
 *
 * Возвращаемый JSON Schema strict — см. `DECISION_EXTRACT_JSON_SCHEMA`.
 * На входе — текст блока (criticalQuestion + trustedAnswer + tags + цитаты) +
 * контекст из ±2 минут той же встречи (для извлечения rationale).
 *
 * Главное правило: НЕ выдумывать факты вне блока. Если поле отсутствует —
 * null. Авторы и затронутые сущности — текстовыми hint'ами, резолв через
 * name-match выполняет сервис.
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withDecisionDiscriminator,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';
import {
  TASK_VS_DECISION_RULE,
  renderExamplesForDecisionExtractor,
} from './task-decision-examples';

export const DECISION_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    withDecisionDiscriminator(
    [
    'Ты — knowledge-инженер реестра решений компании «Кора». Тебе дают один блок знания из встречи или документа, где зафиксировано решение либо его обоснование.',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: решения компании — её осознанный выбор. По реестру руководитель видит, что и почему решили, а команда не переоткрывает закрытые вопросы. Самое ценное в карточке — rationale (почему так решили), а не сам факт.',
    '- Кому уйдёт результат: карточка решения показывается людям в кабинете и питает профили компетенций и цифровых двойников ролей.',
    '- Что станет с результатом: выдуманное или пустое решение засоряет реестр; пропущенное обоснование обедняет память.',
    '',
    'Извлеки структурированный черновик решения на русском языке. Не выдумывай факты вне блока: нет поля — оставь null.',
    '',
    'Особое внимание:',
    '- isDecision — true, только если фрагмент содержит ПРИНЯТОЕ решение; false — если это пожелание/обсуждение/вопрос без решения. На false остальные поля можно вернуть пустыми/нулевыми.',
    '- statement — суть решения одним связным предложением («Ушли с поставщика X в пользу Y»).',
    '- rationale — ПОЧЕМУ так решили. Это самый ценный кусок: вытаскивай прямую логику из reasoning-блоков и цитат.',
    '- alternatives — какие варианты рассматривали и почему отвергли. Нет в блоке — пустой массив.',
    '- decidedByPersonHints — имена людей, принявших решение (как звучит в блоке). Не выдумывай имена.',
    '- affectsEntityHints — на кого/на что влияет: клиент, проект, продукт, поставщик, процесс (с типом customer/project/product/vendor/process).',
    '- decidedAt — ISO-8601, если в блоке есть конкретная дата; иначе null. deadline — срок исполнения; нет — null.',
    '- status — по умолчанию "approved" (решение принято и зафиксировано). Иное значение — только если в блоке явно сказано (отклонили, внедрили, отменили).',
    '- confidence — насколько уверенно извлёк суть решения (0..1).',
    '- impliesAction — true, если решение влечёт КОНКРЕТНУЮ работу к исполнению (мигрировать, настроить, подготовить, заключить). «Решили НЕ делать X», стратегический/ценностный выбор без конкретного действия → false.',
    '- actionTitle — если impliesAction=true: суть действия в ПОВЕЛИТЕЛЬНОМ наклонении («Подготовить смету», «Настроить мониторинг»); иначе null.',
    '',
    '# Чистый русский на выходе',
    'Все человеческие строки (statement, rationale, имена, названия сущностей) — на чистом русском, без кодов, латиницы и служебных идентификаторов. Технические поля (status, тип сущности) ты выбираешь из допустимых значений — но в человеческий текст эти коды-слова не вставляй.',
    '',
    TASK_VS_DECISION_RULE,
    '',
    renderExamplesForDecisionExtractor(),
    '',
    '# Примеры (плохо → хорошо)',
    'Положительный (что извлечь):',
    'Блок «Поставщик SMS» (принятое решение). Цитаты: «Иван: смотрели Twilio и SMS Aero. Маша: Twilio дорогой в России, SMS Aero справился с тестом доставки в 99%. Сергей: окей, идём с SMS Aero, договор на квартал».',
    'Вывод: {"isDecision": true, "statement": "Уходим к поставщику SMS Aero вместо Twilio.", "rationale": "Twilio слишком дорогой в России; SMS Aero показал 99% доставку на тестах.", "alternatives": [{"option": "Twilio", "reasonRejected": "дорогой в РФ"}], "decidedByPersonHints": ["Сергей"], "affectsEntityHints": [{"name": "SMS Aero", "type": "vendor"}], "decidedAt": null, "deadline": null, "status": "approved", "confidence": 0.85}.',
    '',
    'Положительный (решение об ОТКАЗЕ — status ≠ approved):',
    'Блок «Интеграция с Битрикс» (принятое решение). Цитаты: «Обсудили интеграцию с Битрикс — решили НЕ делать в этом квартале, нет ресурсов».',
    'Вывод: {"isDecision": true, "statement": "Отказались от интеграции с Битрикс в этом квартале.", "rationale": "Нет свободных ресурсов в этом квартале.", "alternatives": [], "decidedByPersonHints": [], "affectsEntityHints": [{"name": "Битрикс", "type": "product"}], "decidedAt": null, "deadline": null, "status": "rejected", "confidence": 0.8}.',
    '',
    'Что НЕ делать (пожелание без обязательства):',
    'Блок «Дизайн админки». Цитаты: «Анна: хорошо бы когда-нибудь переделать админку под тёмную тему. Иван: да, не помешало бы».',
    'Вывод: {"isDecision": false, "statement": "недостаточно сигнала для извлечения решения", "rationale": null, "alternatives": [], "decidedByPersonHints": [], "affectsEntityHints": [], "decidedAt": null, "deadline": null, "status": "proposed", "confidence": 0.2}. «Хорошо бы когда-нибудь» — пожелание, не решение; ответственного и срока нет → низкий confidence.',
    '',
    'Что НЕ делать (бытовое не-действие):',
    'Блок «Жалоба на плеер». Цитаты: «Елена: отдельную задачу по жалобе на плеер пока не завожу».',
    'Вывод: {"isDecision": false, "statement": "недостаточно сигнала для извлечения решения", "rationale": null, "alternatives": [], "decidedByPersonHints": [], "affectsEntityHints": [], "decidedAt": null, "deadline": null, "status": "proposed", "confidence": 0.15}. Индивидуальный отказ завести задачу мимоходом — не зафиксированное решение команды; не decision и не задача. (Иное — «решили НЕ делать X» с обоснованием командой → isDecision=true, status=rejected.)',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '0. Это не постановка задачи / поручение / взятие задачи (в т.ч. со словом «задача»)? Если кому-то поручают сделать действие — isDecision=false.',
    '0b. Это не бытовое индивидуальное «пока не завожу / не будем сейчас» мимоходом? Если да — isDecision=false (не решение команды).',
    '1. isDecision=true стоит только при реально ПРИНЯТОМ выборе, а не пожелании/вопросе/обсуждении?',
    '2. rationale вытащен (главная ценность), если он есть в блоке или контексте?',
    '3. status соответствует блоку (approved по умолчанию; иное — только если явно сказано)?',
    '4. Имена, сущности и даты взяты только из блока, ничего не выдумано?',
    '5. В человеческих строках нет кодов, латиницы и идентификаторов?',
    '',
    'Верни строго JSON по схеме decision_extract_v1. Никакого текста вне JSON.',
    ].join('\n'),
    ),
  ),
  ),
);

export const DECISION_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
  contextQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const context = args.contextQuotes.length
    ? args.contextQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (контекста нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}».`,
    `Тип сигнала: ${signalTypeLabel(args.signalType)}.`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    `Контекст (±2 минуты той же встречи — для извлечения rationale):`,
    context,
    '',
    'Верни JSON-объект по схеме `decision_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `decision-extract`. Поддерживается DeepSeek V4 и
 * OpenAI Responses API; Ollama (qwen3) fallback падает с
 * `LlmFormatNotSupportedError` — роутер переходит к secondary/primary.
 */
export const DECISION_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['isDecision', 'statement', 'confidence', 'impliesAction'],
  properties: {
    isDecision: {
      type: 'boolean',
      description:
        'true — фрагмент содержит принятое решение; false — пожелание/обсуждение/вопрос без решения.',
    },
    impliesAction: {
      type: 'boolean',
      description:
        'true — решение влечёт конкретную работу, которую надо выполнить; false — «решили НЕ делать»/стратегия без конкретного действия.',
    },
    actionTitle: {
      type: ['string', 'null'],
      maxLength: 300,
      description:
        'Действие в повелительном наклонении («Мигрировать БД на PostgreSQL»); null если impliesAction=false.',
    },
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть решения одним связным предложением.',
    },
    rationale: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Почему так решили — главный источник для Skill и Insights.',
    },
    alternatives: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option'],
        properties: {
          option: { type: 'string', minLength: 1, maxLength: 500 },
          reasonRejected: {
            type: ['string', 'null'],
            maxLength: 1_000,
          },
        },
      },
    },
    decidedByPersonHints: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 200 },
      description: 'Имена авторов решения (текст).',
    },
    affectsEntityHints: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          type: {
            type: 'string',
            enum: ['customer', 'project', 'product', 'vendor', 'process'],
          },
        },
      },
    },
    decidedAt: {
      type: ['string', 'null'],
      description: 'ISO-8601 дата решения. null если в блоке не указано.',
    },
    deadline: {
      type: ['string', 'null'],
      description: 'ISO-8601 срок исполнения.',
    },
    status: {
      type: 'string',
      enum: [
        'proposed',
        'approved',
        'rejected',
        'implemented',
        'cancelled',
      ],
      description:
        'Статус решения. По умолчанию "approved" (зафиксировано как принятое).',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const DECISION_EXTRACT_SCHEMA_NAME = 'decision_extract_v1';
