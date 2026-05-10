import { z } from 'zod';

/**
 * DTO дашборда директора (Фаза 8 knowledge-core).
 *
 * Один эндпоинт `GET /api/v1/dashboard/director?period=week|month` отдаёт
 * единый объект с 6 виджетами (новые темы, новые сигналы, счётчики сигналов,
 * активные темы, главные сущности, открытые вопросы) + опциональный
 * `narrativeSummary` (LLM-сводка «Главное за неделю»).
 *
 * См. ТЗ §«DTO» — поля строго совпадают с frontend `DirectorDashboardApi`.
 */

export const DirectorDashboardQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
});
export type DirectorDashboardQuery = z.infer<typeof DirectorDashboardQuerySchema>;

export interface DirectorDashboardThemeDto {
  id: string;
  name: string;
  branch: string | null;
  weight: number;
  dynamic: 'growing' | 'stable' | 'declining';
  blocksCount: number;
  /** Только для `activeThemes`. Для `newThemes` всегда `null`. */
  lastSignalAt: string | null;
}

export interface DirectorDashboardSignalDto {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  /** Truncate до 280 символов. */
  trustedAnswer: string;
  /** Если первое evidence ссылается на встречу (RawEvent.sourceType=meeting),
   *  возвращаем meetingId (RawEvent.sourceExternalId). Иначе null. */
  evidenceMeetingId: string | null;
}

export interface DirectorDashboardSignalCountersDto {
  pain: number;
  feature_request: number;
  churn_risk: number;
  objection: number;
  risk: number;
  decision: number;
  commitment: number;
  /** Сумма всех остальных signalType (mood/drift/competitor_move/metric_change/idea/fact/knowledge_gap). */
  other: number;
}

export interface DirectorDashboardEntityDto {
  id: string;
  canonicalName: string;
  type: string;
  recentMentions: number;
}

export interface DirectorDashboardOpenQuestionDto {
  id: string;
  name: string;
  criticalQuestion: string;
  createdAt: string;
}

export interface DirectorDashboardDto {
  period: 'week' | 'month';
  generatedAt: string;
  newThemes: DirectorDashboardThemeDto[];
  newSignals: DirectorDashboardSignalDto[];
  signalCounters: DirectorDashboardSignalCountersDto;
  activeThemes: DirectorDashboardThemeDto[];
  hotEntities: DirectorDashboardEntityDto[];
  openQuestions: DirectorDashboardOpenQuestionDto[];
  /** null = LLM недоступен или вернул ошибку. UI скрывает блок. */
  narrativeSummary: string | null;
}
