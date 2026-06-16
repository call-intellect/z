import { withConfidenceCalibration } from '../../ai/services/prompts/common';

export const FACT_SUPERSEDE_DETECT_SCHEMA_NAME = 'fact_supersede_detect_v1';

export const FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT = withConfidenceCalibration(
  [
    'Ты — knowledge-арбитр памяти компании. Тебе дают новый factual-блок и top-K похожих существующих блоков того же типа (signalType) той же организации.',
    'Реши, как новый блок соотносится с каждым из существующих, и выбери ОДИН verdict для всей группы. Целевой кандидат указывай через `targetBlockId` (id из переданного списка).',
    '',
    'Возможные verdicts:',
    '- "unrelated" — нет совпадений по сути ни с одним кандидатом. `targetBlockId` не указывай.',
    '- "extends" — новый блок дополняет один из кандидатов (та же сущность/тема, новые детали), оба остаются верными. Укажи `targetBlockId` дополняемого блока.',
    '- "contradicts" — новый и один из кандидатов противоречат друг другу, но НЕ ясно, кто из них теперь верен (старый блок ещё может быть актуален). Укажи `targetBlockId` противоречащего блока.',
    '- "supersedes" — новый блок ЯВНО заменяет один из кандидатов: содержательно другая логика, явное изменение факта или обещания (например, «срок сдачи теперь 1 декабря, а не 15 ноября»). Старый блок перестаёт быть верным. Укажи `targetBlockId`.',
    '',
    'Будь консервативен:',
    '- "supersedes" — только если очевидно, что новый блок отменяет старый. Если сомнение — выбирай "contradicts".',
    '- "extends" — только если оба блока про одну и ту же сущность и не конфликтуют по фактам.',
    '- При неопределённости — "unrelated". Лучше пропустить закрытие, чем ошибочно закрыть верный блок.',
    '',
    '`confidence` — твоя уверенность в verdict (0.0..1.0). `reason` — кратко (1-3 предложения) почему ты выбрал именно этот verdict, на русском.',
    '',
    'Отвечай строго в формате JSON по схеме fact_supersede_detect_v1.',
  ].join('\n'),
);

export interface FactSupersedeDetectCandidate {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  validFrom: string | null;
  evidenceQuote?: string | null;
}

export interface FactSupersedeDetectNewBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  validFrom: string | null;
  evidenceQuote?: string | null;
}

export const FACT_SUPERSEDE_DETECT_USER_TEMPLATE = (args: {
  newBlock: FactSupersedeDetectNewBlock;
  candidates: ReadonlyArray<FactSupersedeDetectCandidate>;
}): string => {
  const newLines = [
    'Новый блок:',
    `  id: ${args.newBlock.id}`,
    `  name: ${args.newBlock.name}`,
    `  signalType: ${args.newBlock.signalType}`,
    `  criticalQuestion: ${args.newBlock.criticalQuestion}`,
    `  trustedAnswer: ${args.newBlock.trustedAnswer}`,
    `  validFrom: ${args.newBlock.validFrom ?? '(не указано)'}`,
    args.newBlock.evidenceQuote ? `  evidenceQuote: ${args.newBlock.evidenceQuote}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
  const candidatesText = args.candidates.length
    ? args.candidates
        .map((c, i) => {
          return [
            `Кандидат #${i + 1} (id=${c.id}):`,
            `  name: ${c.name}`,
            `  signalType: ${c.signalType}`,
            `  criticalQuestion: ${c.criticalQuestion}`,
            `  trustedAnswer: ${c.trustedAnswer}`,
            `  validFrom: ${c.validFrom ?? '(не указано)'}`,
            c.evidenceQuote ? `  evidenceQuote: ${c.evidenceQuote}` : '',
          ]
            .filter((s) => s.length > 0)
            .join('\n');
        })
        .join('\n\n')
    : '(нет кандидатов — это новый одиночный факт)';
  return `${newLines}\n\n${candidatesText}\n\nВерни JSON по схеме fact_supersede_detect_v1.`;
};

export const FACT_SUPERSEDE_DETECT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason', 'confidence'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['unrelated', 'extends', 'contradicts', 'supersedes'],
    },
    targetBlockId: {
      type: ['string', 'null'],
      description:
        'id одного из переданных кандидатов (для extends/contradicts/supersedes); null для unrelated.',
    },
    reason: { type: 'string', maxLength: 1_500 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export type FactSupersedeVerdict = 'unrelated' | 'extends' | 'contradicts' | 'supersedes';

export interface FactSupersedeDetectResponse {
  verdict: FactSupersedeVerdict;
  targetBlockId?: string | null;
  reason: string;
  confidence: number;
}
