/**
 * SBA β-8.1 — промпт `checkin-sentiment`.
 *
 * Источник: plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md §9.
 *
 * Задача: на вход — сырой текст вечернего чек-ина сотрудника. На выход —
 * строгий JSON с настроением (`sentiment ∈ green|yellow|red`) + коротким
 * обоснованием (`rationale`, до 200 символов).
 *
 * Code-fallback (без PromptRegistry) — допустимо на β-8.1, как было сделано
 * для `dashboard-summary` (sub-ТЗ §9). Когда промпт стабилизируется —
 * перенесём в админский PromptRegistry.
 *
 * Версия промпта — `prompt-v1`. Caller сохраняет в `DailyCheckIn.sentimentVersion`
 * композицию `prompt-v1+<modelUsed>` для аудита.
 */

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

/**
 * Сборка user-сообщения для LLM. Сериализация — компактная: метка типа +
 * сам текст (обрезанный до 4000 символов).
 */
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

/** Допустимые значения настроения. */
export const CHECKIN_SENTIMENT_VALUES = ['green', 'yellow', 'red'] as const;
export type CheckinSentiment = (typeof CHECKIN_SENTIMENT_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// ТЗ 2026-05-25 LLM-architecture §6 — BATCH-вариант checkin-sentiment.
//
// Эксперимент 4 (`backend/test/eval/operations-experiment/`):
//   - single (старый) — точность 24/25 (96%), $0.0080.
//   - batch 10× (новый) — точность 25/25 (100%), $0.0039 (в 2× дешевле),
//     +20% быстрее. Cache hit 93% vs 76%.
// Размер батча 10 выбран эмпирически. Каждый чек-ин обрамлён `═══ [id] ═══`
// для надёжного связывания id с результатом.
// Модель — `deepseek-v4-pro` (через router taskType='checkin-sentiment-batch').
// max_tokens = 8000 — thinking-токены + JSON-output на 10 элементов.
// Референс — `backend/scripts/eval/run-checkin-batch.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export const CHECKIN_SENTIMENT_BATCH_PROMPT_VERSION = 'prompt-batch-v1';

/** Размер батча. См. §6.4 — 10 эмпирически отобрано. */
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

/**
 * Tool-схема `submit_batch_sentiments`. Передаётся в `LlmRouterService.call({ tools: [...] })`.
 * `LlmTool.input_schema` — JSON Schema аргументов.
 */
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

/** Элемент batch для построения user-сообщения. */
export interface CheckinSentimentBatchItem {
  checkInId: string;
  rawText: string;
}

/**
 * Сборка user-сообщения batch'а: каждый чек-ин обрамлён `═══ [id] ═══`.
 * См. §6.4 ТЗ — это критично для надёжного связывания id с результатом.
 */
export function buildCheckinSentimentBatchUserMessage(
  items: CheckinSentimentBatchItem[],
): string {
  const lines: string[] = [];
  lines.push(
    `Классифицируй настроение для ${items.length} вечерних чек-инов ниже.`,
  );
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

/** Результат одного элемента batch'а. */
export interface CheckinSentimentBatchResult {
  checkInId: string;
  sentiment: CheckinSentiment;
  rationale: string;
}

/**
 * Парсер tool_call `submit_batch_sentiments`. Безопасный: при любых
 * нарушениях схемы возвращает только валидные элементы (некорректные
 * молча пропускаются, чтобы один кривой пункт не сломал весь батч).
 *
 * Исключение — **дубликат `checkInId`** в результате: бросаем `Error`.
 * Решение пользователя 2026-05-26 (см. ТЗ §1 пункт 4 / §2.2 Кейс 8):
 * лучше упасть на одном пакете и переобработать его, чем тихо писать
 * случайные данные в БД (с риском перепутать настроение разных людей).
 * Внешний try/catch в cron'е поймает throw и инкрементит
 * `coo_sentiment_failed_total` на каждый элемент батча.
 */
export function parseCheckinSentimentBatchToolInput(
  input: unknown,
): CheckinSentimentBatchResult[] {
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
    if (
      sentiment !== 'green' &&
      sentiment !== 'yellow' &&
      sentiment !== 'red'
    ) {
      continue;
    }
    const rationale =
      typeof obj.rationale === 'string' ? obj.rationale.slice(0, 1_000) : '';
    out.push({ checkInId, sentiment, rationale });
  }
  // Детекция дубликата checkInId — ПОСЛЕ валидации каждого элемента,
  // ДО возврата. Если LLM вернул один id дважды — неизвестно какой
  // sentiment правильный, поэтому весь батч считаем failed.
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
