import { withAsrNote, withConfidenceCalibration } from '../../ai/services/prompts/common';

export const AXIS_CLASSIFY_SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(
    [
      'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа компании.',
      'Твоя задача — разметить его по 4 осям знания: functional (функциональная область) и temporal (временное измерение).',
      'who и contextual оси уже размечены статикой (entities блока) — их трогать не нужно.',
      '',
      'Отвечай строго в формате JSON по схеме axis_classify_v1.',
      '',
      'Правила:',
      "- functional: укажи slug'и из whitelist'а доменов, к которым относится содержимое блока. Если ни один не подходит — оставь пустой массив.",
      '- temporal: одно из значений ["temporal:permanent", "temporal:current", "temporal:past", "temporal:future", "temporal:periodic"]. permanent — для регламентов/политик/процессов без срока; current — для текущих задач/проектов; past — для решений/уроков/историй; future — для планов/гипотез/идей; periodic — для повторяющихся процессов.',
      '- confidence: 0..1 — твоя уверенность в каждой метке отдельно (per-label).',
    ].join('\n'),
  ),
);

export const AXIS_CLASSIFY_USER_TEMPLATE = (args: {
  blockName: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: readonly string[];
  domainWhitelist: ReadonlyArray<{ slug: string; name: string }>;
}): string => {
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  const domains = args.domainWhitelist.length
    ? args.domainWhitelist.map((d) => `  - ${d.slug}: ${d.name}`).join('\n')
    : '  (whitelist доменов пуст — верни functional=[])';
  return [
    `Блок «${args.blockName}» (signalType=${args.signalType}).`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    '',
    'Whitelist функциональных доменов:',
    domains,
    '',
    'Верни JSON-объект по схеме `axis_classify_v1`.',
  ].join('\n');
};

export const AXIS_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['functional', 'temporal'],
  properties: {
    functional: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'confidence'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 80 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    temporal: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'confidence'],
        properties: {
          label: {
            type: 'string',
            enum: [
              'temporal:permanent',
              'temporal:current',
              'temporal:past',
              'temporal:future',
              'temporal:periodic',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};
