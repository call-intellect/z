/**
 * Доменная модель метрики AI-чата (TZ-1 Фаза 5 — «Память в работе»).
 *
 * Контракт: `GET /api/v1/chat-v2/usage-stats?from=&to=&scope=self|org`.
 * Источник правды: `backend/.../dto/chat-v2-feedback.dto.ts:ChatV2UsageStatsDto`.
 *
 * Слои:
 *   - `ChatV2UsageStatsApi` — что приходит с бэка (см. `src/api/chat-v2.api.ts`).
 *   - `ChatUsageStatsDomain` — UI-friendly (поля как есть, типизированы; даты
 *     приходят как `YYYY-MM-DD` строки и используются «как лейбл», поэтому
 *     не превращаем в `Date`).
 *
 * `helpedRateHidden=true` → процент «помог ли ответ» скрыт (rated < minRated):
 * UI показывает «мало данных», а не цифру.
 */

import type { ChatV2UsageStatsApi } from '@/api/chat-v2.api';

export interface ChatUsageStatsDomain {
  /** Начало окна (YYYY-MM-DD, как лейбл). */
  from: string;
  /** Конец окна (YYYY-MM-DD, как лейбл). */
  to: string;
  scope: 'self' | 'org';
  /** Сколько вопросов задали (user-сообщения). */
  asked: number;
  /** Сколько ответов дала Кора (assistant-сообщения). */
  answered: number;
  /** Ответы с привязкой к источнику (grounding-proxy, НЕ «дефлекция»). */
  answeredWithCitation: number;
  /** Сколько ответов оценили (палец вверх/вниз). */
  rated: number;
  /** Сколько ответов отметили «помог». */
  helpedUp: number;
  /** helpedUp/rated, %. null = скрыт (rated < minRated, «мало данных»). */
  helpedRatePercent: number | null;
  /** rated/answered, % — покрытие фидбеком. */
  feedbackCoveragePercent: number;
  /** answeredWithCitation/answered, % — доля ответов с источником. */
  groundedRatePercent: number;
  /** true → процент «помог» скрыт (мало оценок). */
  helpedRateHidden: boolean;
  /** Порог числа оценок, ниже которого процент скрывается. */
  minRated: number;
}

export function chatUsageStatsFromApi(
  api: ChatV2UsageStatsApi,
): ChatUsageStatsDomain {
  return {
    from: api.from,
    to: api.to,
    scope: api.scope,
    asked: api.asked,
    answered: api.answered,
    answeredWithCitation: api.answeredWithCitation,
    rated: api.rated,
    helpedUp: api.helpedUp,
    helpedRatePercent: api.helpedRatePercent,
    feedbackCoveragePercent: api.feedbackCoveragePercent,
    groundedRatePercent: api.groundedRatePercent,
    helpedRateHidden: api.helpedRateHidden,
    minRated: api.minRated,
  };
}
