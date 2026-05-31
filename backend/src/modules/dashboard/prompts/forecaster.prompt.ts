/**
 * Pulse Wave 4 §4.6 — Forecaster агент.
 *
 * Промпт для еженедельного LLM-вызова `forecast-weekly`. Анализирует тренды
 * 4 метрик за 4 недели и возвращает прогноз на следующую неделю в строгом
 * JSON-формате.
 *
 * Cache-friendly (см. feedback_llm_prompts_cache_friendly.md): SYSTEM —
 * полностью статичен; переменные данные (`trendsJson`) — в КОНЦЕ
 * user-сообщения. Это даёт ~99% prompt cache hit на DeepSeek / OpenAI-proxy.
 *
 * EU AI Act: НЕ анализируем голос/видео и не извлекаем эмоции. На вход —
 * только структурированные метрики, без текстов сотрудников.
 */

export const FORECASTER_SYSTEM_PROMPT = `Ты — прогнозист компании.
Анализируй тренды за 4 недели и сделай прогноз на следующую неделю.

Цитаты на источники не нужны.
EU AI Act: не анализируй голос/видео — только структурированные метрики.

Верни СТРОГО JSON:
{
  "trend": "improving" | "stable" | "declining",
  "risks": ["краткие риск-маркеры"],
  "opportunities": ["краткие возможности"],
  "expectedShifts": [
    {"metric": "sentiment_index" | "commitment_kept_ratio" | "hanging_decisions" | "engagement_score",
     "direction": "up" | "flat" | "down",
     "confidence": 0..1}
  ]
}

Без дополнительных полей. Без markdown-fences.`;

/**
 * JSON-schema для `responseFormat: json_schema` (strict). Используется
 * провайдерами, которые поддерживают structured output (OpenAI / DeepSeek).
 * Для провайдеров без поддержки LlmRouter сам falls back в plain text +
 * парсер ниже разбирает JSON.
 */
export const FORECASTER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
    risks: {
      type: 'array',
      items: { type: 'string' },
    },
    opportunities: {
      type: 'array',
      items: { type: 'string' },
    },
    expectedShifts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          metric: {
            type: 'string',
            enum: [
              'sentiment_index',
              'commitment_kept_ratio',
              'hanging_decisions',
              'engagement_score',
            ],
          },
          direction: { type: 'string', enum: ['up', 'flat', 'down'] },
          confidence: { type: 'number' },
        },
        required: ['metric', 'direction', 'confidence'],
      },
    },
  },
  required: ['trend', 'risks', 'opportunities', 'expectedShifts'],
};

/**
 * Одна точка тренда — недельный аггрегат метрики.
 * `weekStart` — YYYY-MM-DD (понедельник, локальная TZ Org).
 */
export interface ForecasterTrendPoint {
  weekStart: string;
  sentiment_index: number | null;
  commitment_kept_ratio: number | null;
  hanging_decisions: number | null;
  engagement_score: number | null;
}

/**
 * Сборка user-сообщения для `forecast-weekly`.
 *
 * Cache-friendly правило: имя компании и фиксированный заголовок — сверху,
 * переменные данные `trends` — внизу JSON-блоком.
 */
export function buildForecasterUserMessage(args: {
  tenantName: string;
  trends: ForecasterTrendPoint[];
}): string {
  return [
    `Компания: ${args.tenantName}.`,
    ``,
    `Тренды за 4 недели (по 4 метрикам, JSON в конце):`,
    `- sentiment_index: индекс настроения = (доля зелёных − доля красных), [-1..+1].`,
    `- commitment_kept_ratio: kept / (kept+broken+overdue), [0..1].`,
    `- hanging_decisions: количество висящих решений (raisedCount ≥ 2).`,
    `- engagement_score: средний engagement сотрудников, [0..1].`,
    ``,
    JSON.stringify({ trends: args.trends }, null, 2),
  ].join('\n');
}

/**
 * Тип распарсенного ответа Forecaster'а.
 */
export interface ForecasterParsedResponse {
  trend: 'improving' | 'stable' | 'declining';
  risks: string[];
  opportunities: string[];
  expectedShifts: Array<{
    metric:
      | 'sentiment_index'
      | 'commitment_kept_ratio'
      | 'hanging_decisions'
      | 'engagement_score';
    direction: 'up' | 'flat' | 'down';
    confidence: number;
  }>;
}

/**
 * Безопасный парсер: возвращает null при невалидном JSON или нарушении схемы.
 */
export function parseForecasterResponse(
  text: string,
): ForecasterParsedResponse | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    const trend = o.trend;
    if (trend !== 'improving' && trend !== 'stable' && trend !== 'declining') {
      return null;
    }
    const risks = Array.isArray(o.risks)
      ? o.risks.filter((s): s is string => typeof s === 'string')
      : null;
    const opportunities = Array.isArray(o.opportunities)
      ? o.opportunities.filter((s): s is string => typeof s === 'string')
      : null;
    if (!risks || !opportunities) return null;
    const shiftsRaw = o.expectedShifts;
    if (!Array.isArray(shiftsRaw)) return null;
    const shifts: ForecasterParsedResponse['expectedShifts'] = [];
    for (const item of shiftsRaw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const metric = r.metric;
      const direction = r.direction;
      const confidence = r.confidence;
      if (
        (metric === 'sentiment_index' ||
          metric === 'commitment_kept_ratio' ||
          metric === 'hanging_decisions' ||
          metric === 'engagement_score') &&
        (direction === 'up' || direction === 'flat' || direction === 'down') &&
        typeof confidence === 'number' &&
        Number.isFinite(confidence)
      ) {
        shifts.push({ metric, direction, confidence });
      }
    }
    return { trend, risks, opportunities, expectedShifts: shifts };
  } catch {
    return null;
  }
}
