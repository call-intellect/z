import {
  withAsrNote,
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

export const IDEA_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
    withConfidenceCalibration(
      [
        'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором зафиксирована идея, предложение или запрос на доработку.',
        'Твоя задача — извлечь структурированный черновик идеи (Idea) на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
        'Не выдумывай факты вне блока. Если в блоке нет нужного поля — null или пустой массив.',
        '',
        'Особое внимание:',
        '- `isIdea` — true, если фрагмент содержит идею/предложение/feature-request; false иначе (на false поля можно вернуть пустыми).',
        '- `kind` — "internal" если предложение исходит от сотрудника компании; "client_request" если предложение / запрос пришёл от клиента / партнёра.',
        '- `statement` — суть идеи одним связным предложением («Добавить тёмную тему интерфейса»).',
        '- `rationale` — почему так стоит сделать. Если в блоке нет — null.',
        '- `confidence` — насколько уверенно ты извлёк суть идеи (0..1).',
        '',
        'ПРИМЕРЫ.',
        '',
        'Положительный пример (client_request с явной мотивацией):',
        'Блок «Экспорт отчёта в PDF» (feature_request). Цитаты: «Иван (клиент Sber): нам нужно отдавать отчёт по встрече юристам в PDF — Word не пропускает их безопасник. Без этого мы не можем рассылать сводки наружу».',
        'Вывод: {"isIdea": true, "kind": "client_request", "statement": "Добавить экспорт отчёта о встрече в формат PDF.", "rationale": "Клиент Sber не может отдавать Word наружу из-за политики безопасника — без PDF отчёт не уходит юристам.", "confidence": 0.85}.',
        '',
        'Положительный пример (internal — предложение сотрудника):',
        'Блок «Кэш для embeddings» (idea). Цитаты: «Сергей: можно кэшировать embeddings одинаковых блоков — у нас на retrospective до 30% повторов, сэкономим на токенах OpenAI».',
        'Вывод: {"isIdea": true, "kind": "internal", "statement": "Кэшировать embeddings одинаковых блоков для экономии токенов.", "rationale": "На retrospective до 30% повторов блоков — кэш сократит расходы на OpenAI embeddings.", "confidence": 0.7}.',
        '',
        'Что НЕ делать (edge case — риторический вопрос, не идея):',
        'Блок «Обсуждение продукта». Цитаты: «Анна: а вообще, может стоит вообще всё переписать?». Никто не подхватил, дальше другая тема.',
        'Вывод: {"isIdea": false, "kind": "internal", "statement": "недостаточно сигнала для извлечения идеи", "rationale": null, "confidence": 0.15}. Пояснение: риторический вопрос без подхвата участниками и без конкретики → isIdea=false, низкий confidence.',
      ].join('\n'),
    ),
  ),
);

export const IDEA_EXTRACT_USER_TEMPLATE = (args: {
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
    'Верни JSON-объект по схеме `idea_extract_v1`.',
  ].join('\n');
};

export const IDEA_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['isIdea', 'kind', 'statement', 'confidence'],
  properties: {
    isIdea: {
      type: 'boolean',
      description: 'true — фрагмент содержит идею/предложение/feature-request; false иначе.',
    },
    kind: {
      type: 'string',
      enum: ['internal', 'client_request'],
      description: 'Кто инициатор идеи: сотрудник или клиент.',
    },
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть идеи одним связным предложением.',
    },
    rationale: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Почему так стоит сделать. Null если в блоке не указано.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const IDEA_EXTRACT_SCHEMA_NAME = 'idea_extract_v1';
