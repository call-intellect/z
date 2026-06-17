import { withConfidenceCalibration } from '../../ai/services/prompts/common';

export const HELPFULNESS_DETECT_SYSTEM_PROMPT = withConfidenceCalibration(
  [
    'Ты — knowledge-инженер. Тебе дают один IdeaBlock (фрагмент переписки в задаче, цитата из встречи, чек-ин).',
    "Твоя задача — извлечь 0..3 helpfulness trait'а: паттерны помощи, mentoring, поддержки, а также неотвеченные вопросы.",
    '',
    'Возможные значения traitType (строго один из списка):',
    '  - help_provided — развёрнутый ответ на вопрос коллеги (с конкретикой, не отписка).',
    '  - proactive_hint — подсказка без запроса («кстати, у нас есть инструкция»).',
    '  - mentoring — обучающее объяснение (не просто «делай Y», а «потому что Z»).',
    '  - emotional_support — «не переживай», «давай разберёмся вместе», поддержка.',
    '  - constructive_feedback — критика с предложением решения (не «плохо», а «вижу проблему X, попробуй Y»).',
    '  - question_unanswered — вопрос задан конкретному человеку, и за 48ч+ нет ответа.',
    '  - question_acknowledged_no_action — «хорошо, посмотрю» → нет следующего шага.',
    '',
    'ВАЖНО — правила:',
    '1. helperUserHint — короткое имя/упоминание помощника (например, «Иван Петров», «@masha»). Никаких UUID — мы их сами резолвим.',
    '2. recipientUserHint — кому помогли (опц., только если явно в тексте).',
    '3. topicHint — короткая тема помощи (3-7 слов), на русском: «настройка платежей», «найм фронтенда», «UI-планёрка». НЕ enum, по смыслу.',
    '4. intensity — 0..1: 0.3 для эпизодического, 0.6 для развёрнутого, 0.9 для глубокого менторинга.',
    '5. evidenceQuote — точная цитата из блока (≤300 символов).',
    '6. confidence — 0..1 (шкала калибровки — ниже).',
    '7. Если в блоке нет ничего про помощь — возвращай `traits: []`.',
    '',
    'НЕ ДЕЛАЙ:',
    '- Не выдумывай факты вне цитат.',
    '- Не давай traitType вне списка выше.',
    '- Не путай помощь и формальный ответ начальника подчинённому (это про работу, не про щедрость).',
    '- Не используй персональные данные (национальность, здоровье) — только рабочее поведение.',
  ].join('\n'),
);

export const HELPFULNESS_DETECT_USER_TEMPLATE = (args: {
  blockName: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const quotesLines = args.evidenceQuotes.length
    ? args.evidenceQuotes
        .slice(0, 8)
        .map((q, i) => `  ${i + 1}. «${q.slice(0, 400)}»`)
        .join('\n')
    : '  (цитат нет — используй criticalQuestion + trustedAnswer)';
  return [
    `Блок: ${args.blockName} (signalType=${args.signalType}).`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${args.tags.join(', ') || '(нет)'}`,
    '',
    'Цитаты-источники:',
    quotesLines,
    '',
    'Верни JSON-объект по схеме `helpfulness_detect_v1`.',
  ].join('\n');
};

export const HELPFULNESS_DETECT_SCHEMA_NAME = 'helpfulness_detect_v1';

export const HELPFULNESS_DETECT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['traits'],
  properties: {
    traits: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'traitType',
          'helperUserHint',
          'topicHint',
          'intensity',
          'evidenceQuote',
          'confidence',
        ],
        properties: {
          traitType: {
            type: 'string',
            enum: [
              'help_provided',
              'proactive_hint',
              'mentoring',
              'emotional_support',
              'constructive_feedback',
              'question_unanswered',
              'question_acknowledged_no_action',
            ],
          },
          helperUserHint: { type: 'string', minLength: 1, maxLength: 200 },
          recipientUserHint: { type: 'string', maxLength: 200 },
          topicHint: { type: 'string', maxLength: 120 },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
          evidenceQuote: { type: 'string', minLength: 1, maxLength: 500 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export const HELPFULNESS_TRAIT_MERGE_SYSTEM_PROMPT = [
  "Ты — knowledge-арбитр. Тебе дают два helpfulness trait'а одного и того же помощника с похожими topicHint.",
  'Твоя задача — решить: это одна и та же черта (merge) или две разные (keep_separate).',
  '',
  'Правила:',
  '1. Если topicHint описывают РАЗНЫЕ темы экспертизы (например, «настройка платежей» vs «работа с клиентами») — keep_separate.',
  '2. Если topicHint близкие, но traitType разные (help_provided vs mentoring) — keep_separate (это разные роли).',
  '3. Если topicHint похожи И traitType совпадают — merge: возвращай объединённый trait с большим intensity и обновлённым topicHint.',
  '4. mergedTopicHint — короткая обобщающая фраза (3-7 слов).',
  '5. mergedIntensity = max(intensity_a, intensity_b) — это не average, а сила паттерна.',
  '6. Если уверенности нет — keep_separate (лучше дубль, чем потеря информации).',
].join('\n');

export const HELPFULNESS_TRAIT_MERGE_USER_TEMPLATE = (args: {
  existing: {
    traitType: string;
    topicHint: string | null;
    intensity: number;
    evidenceQuote: string | null;
    lastObservedAt: string;
  };
  incoming: {
    traitType: string;
    topicHint: string | null;
    intensity: number;
    evidenceQuote: string | null;
    lastObservedAt: string;
  };
}): string => {
  return [
    'Существующий trait:',
    `  traitType: ${args.existing.traitType}`,
    `  topicHint: ${args.existing.topicHint ?? '(нет)'}`,
    `  intensity: ${args.existing.intensity}`,
    `  evidenceQuote: «${(args.existing.evidenceQuote ?? '').slice(0, 200)}»`,
    `  lastObservedAt: ${args.existing.lastObservedAt}`,
    '',
    'Новый кандидат:',
    `  traitType: ${args.incoming.traitType}`,
    `  topicHint: ${args.incoming.topicHint ?? '(нет)'}`,
    `  intensity: ${args.incoming.intensity}`,
    `  evidenceQuote: «${(args.incoming.evidenceQuote ?? '').slice(0, 200)}»`,
    `  lastObservedAt: ${args.incoming.lastObservedAt}`,
    '',
    'Верни JSON по схеме `helpfulness_trait_merge_v1`.',
  ].join('\n');
};

export const HELPFULNESS_TRAIT_MERGE_SCHEMA_NAME = 'helpfulness_trait_merge_v1';

export const HELPFULNESS_TRAIT_MERGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', enum: ['merge', 'keep_separate'] },
    mergedTopicHint: { type: 'string', maxLength: 120 },
    mergedIntensity: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', maxLength: 400 },
  },
};

export const HELPFULNESS_SPOTLIGHT_FORMULATE_SYSTEM_PROMPT = [
  "Ты — корпоративный коммуникатор. Тебе дают сводку trait'ов одного помощника за неделю.",
  'Твоя задача — сформулировать одно короткое тёплое сообщение для публичной ленты «Спасибо команде».',
  '',
  'Правила:',
  '1. ТОН: тёплый, конкретный, без официоза и пафоса. Не «Иван — выдающийся помощник», а «Иван 12 раз на этой неделе помог коллегам по вопросам безопасности — спасибо за щедрость с экспертизой».',
  '2. Никакого ранжирования («лучший», «топ»). Только конкретика.',
  '3. Длина message: 1-2 предложения, 100-280 символов.',
  '4. Упоминай topicHint (если есть), и количество случаев помощи.',
  '5. Без эмодзи и без хэштегов.',
  '6. ЯЗЫК: только русский.',
  '7. Если данных мало (< 3 trait\'ов) — verdict="skip" и пустой message.',
].join('\n');

export const HELPFULNESS_SPOTLIGHT_FORMULATE_USER_TEMPLATE = (args: {
  helperName: string;
  helpCount: number;
  topTopics: readonly string[];
  traitBreakdown: Record<string, number>;
  periodFromIso: string;
  periodToIso: string;
}): string => {
  const breakdownLines = Object.entries(args.traitBreakdown)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `  - ${t}: ${n}`)
    .join('\n');
  return [
    `Помощник: ${args.helperName}`,
    `Период: ${args.periodFromIso} → ${args.periodToIso}`,
    `Общее количество случаев помощи: ${args.helpCount}`,
    `Главные темы (topicHint): ${args.topTopics.slice(0, 3).join(', ') || '(не определены)'}`,
    'Распределение по типам trait:',
    breakdownLines || '  (нет)',
    '',
    'Верни JSON по схеме `helpfulness_spotlight_v1`.',
  ].join('\n');
};

export const HELPFULNESS_SPOTLIGHT_FORMULATE_SCHEMA_NAME = 'helpfulness_spotlight_v1';

export const HELPFULNESS_SPOTLIGHT_FORMULATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict'],
  properties: {
    verdict: { type: 'string', enum: ['publish', 'skip'] },
    message: { type: 'string', maxLength: 600 },
    suggestedTopicHint: { type: 'string', maxLength: 120 },
  },
};
