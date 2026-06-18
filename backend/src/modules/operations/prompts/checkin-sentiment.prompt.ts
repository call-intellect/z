export const CHECKIN_SENTIMENT_PROMPT_VERSION = 'prompt-v1';

export const CHECKIN_SENTIMENT_SYSTEM_PROMPT = [
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают короткий свободный текст (что человек сделал за день, что мешает, как ощущения).',
  'Твоя задача — определить общее настроение чек-ина одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'Ответ возвращай строго в формате JSON: {"sentiment":"green|yellow|red","rationale":"короткое обоснование на русском, до 200 символов"}.',
  'Никакого комментария вне JSON. rationale — не цитата сотрудника, а короткое объяснение твоего вывода для администратора.',
  'Если текст пустой, бессмысленный или односложный («ок», «всё хорошо») — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

export function buildCheckinSentimentUserMessage(args: {
  kind: 'morning' | 'evening';
  rawText: string;
}): string {
  const kindLabel =
    args.kind === 'evening'
      ? 'вечерний (что сделано + блокеры + ощущения)'
      : 'утренний (план на день)';
  return [
    `Тип чек-ина: ${kindLabel}.`,
    'Текст сотрудника:',
    (args.rawText ?? '').slice(0, 4_000),
  ].join('\n');
}

export const CHECKIN_SENTIMENT_VALUES = ['green', 'yellow', 'red'] as const;
export type CheckinSentiment = (typeof CHECKIN_SENTIMENT_VALUES)[number];

export const CHECKIN_SENTIMENT_BATCH_PROMPT_VERSION = 'prompt-batch-v1';

export const CHECKIN_SENTIMENT_BATCH_SIZE = 10;

export const CHECKIN_SENTIMENT_BATCH_SYSTEM_PROMPT = [
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают список из N чек-инов (каждый — короткий свободный текст). Для КАЖДОГО определи общее настроение одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'ВАЖНО: оценивай каждый чек-ин САМОСТОЯТЕЛЬНО — не сравнивай между собой и не делай общий тон по неделе.',
  '',
  'Верни результат через инструмент submit_batch_sentiments. Каждый элемент массива — {checkInId, sentiment, rationale}.',
  'rationale — короткое (до 200 символов) обоснование на русском для администратора.',
  'Если текст пустой/бессмысленный/односложный — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

export const CHECKIN_SENTIMENT_BATCH_TOOL = {
  name: 'submit_batch_sentiments',
  description: 'Отдать классификацию настроения для массива чек-инов.',
  input_schema: {
    type: 'object' as const,
    required: ['results'],
    additionalProperties: false,
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['checkInId', 'sentiment', 'rationale'],
          properties: {
            checkInId: { type: 'string' },
            sentiment: { type: 'string', enum: ['green', 'yellow', 'red'] },
            rationale: { type: 'string' },
          },
        },
      },
    },
  },
};

export interface CheckinSentimentBatchItem {
  checkInId: string;
  rawText: string;
}

export function buildCheckinSentimentBatchUserMessage(items: CheckinSentimentBatchItem[]): string {
  const lines: string[] = [];
  lines.push(`Классифицируй настроение для ${items.length} вечерних чек-инов ниже.`);
  lines.push(
    'Каждый чек-ин помечен идентификатором [ID]. Верни результат через submit_batch_sentiments.',
  );
  lines.push('');
  for (const c of items) {
    lines.push(`═══ [${c.checkInId}] ═══`);
    lines.push((c.rawText ?? '').slice(0, 4_000));
    lines.push('');
  }
  return lines.join('\n');
}

export interface CheckinSentimentBatchResult {
  checkInId: string;
  sentiment: CheckinSentiment;
  rationale: string;
}

export function parseCheckinSentimentBatchToolInput(input: unknown): CheckinSentimentBatchResult[] {
  if (!input || typeof input !== 'object') return [];
  const results = (input as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: CheckinSentimentBatchResult[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const checkInId = typeof obj.checkInId === 'string' ? obj.checkInId : null;
    const sentiment = obj.sentiment;
    if (!checkInId) continue;
    if (sentiment !== 'green' && sentiment !== 'yellow' && sentiment !== 'red') {
      continue;
    }
    const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1_000) : '';
    out.push({ checkInId, sentiment, rationale });
  }
  const seen = new Set<string>();
  for (const item of out) {
    if (seen.has(item.checkInId)) {
      throw new Error(
        `checkin-sentiment-batch: дубликат checkInId в результате LLM: ${item.checkInId}`,
      );
    }
    seen.add(item.checkInId);
  }
  return out;
}
