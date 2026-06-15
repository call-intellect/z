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

/**
 * Pulse Wave 1 §1.4 — Transparent Sourcing.
 *
 * `narrativeSummary` теперь возвращается как объект `{ text, citations }`:
 * текст с inline-маркерами `[1]`, `[2]`, ... плюс список цитат с deep-link'ами
 * на источники (темы / встречи / цели / решения).
 */
export type CitationType = 'ib' | 'theme' | 'ent' | 'mtg' | 'goal' | 'dec';

export interface CitationDto {
  number: number;
  type: CitationType;
  id: string;
  label: string;
  url: string | null;
}

export interface NarrativeSummaryDto {
  /** Текст с inline [1], [2], ... вместо [type:id] маркеров. */
  text: string;
  citations: CitationDto[];
}

/**
 * KPI-блок с текущим значением, sparkline за 12 недель и опциональной
 * дельтой к предыдущему окну. Используется тремя KPI на главной (Pulse §1.5).
 */
export interface DirectorDashboardKpiDto {
  /** Текущее значение KPI (число; для процентов 0-100, для индекса -100..+100). */
  value: number;
  /**
   * Sparkline 12 недель old→new. null — в неделе данных нет.
   * Frontend Sparkline-компонент может перевести null в gap или в 0.
   */
  sparkline: Array<number | null>;
  /** Дельта к предыдущему окну в тех же единицах (для commitment — delta14d). null если нет данных. */
  delta: number | null;
  /** Для sentiment — направление тренда; для остальных undefined. */
  trend?: 'up' | 'flat' | 'down';
}

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
  /**
   * ТЗ-2 Ф1 — «почему так» / источник сигнала для drill-down в новой
   * компоновке главной. Если первое evidence резолвится во встречу —
   * `{ meetingId, meetingTitle }`; если в решение — `{ decisionId }`;
   * иначе `null`. `evidenceMeetingId` оставлен без изменений для backward-compat.
   */
  reasonSourceRef: {
    meetingId?: string;
    meetingTitle?: string;
    decisionId?: string;
  } | null;
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

/**
 * ТЗ-2 Ф1 — «Полоса пользы» (Value Strip): 5 твёрдых счётчиков за период,
 * подтверждающих, что Кора сделала работу. Все значения — целые счётчики.
 *
 *   - `meetingsProtocoled`            — встречи с готовым AI-отчётом в окне;
 *   - `tasksExtracted`                — задачи, извлечённые в окне;
 *   - `decisionsExtracted`            — решения, зафиксированные в окне;
 *   - `questionsAnsweredByMemory`     — ответы AI-чата с привязкой к источнику
 *                                       (assistant-сообщения с непустыми citations);
 *   - `commitmentsKept`               — выполненные обещания
 *                                       (IdeaBlock signalType='commitment',
 *                                       commitmentStatus='fulfilled') в окне.
 */
export interface DirectorDashboardValueStripDto {
  meetingsProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  questionsAnsweredByMemory: number;
  commitmentsKept: number;
}

/**
 * Phase 9: блок «Согласованность стратегии» (Goal alignment).
 *
 * `average` — взвешенное среднее `cachedAlignment` активных целей.
 * Если ни одна цель ещё не получила snapshot — `null` (UI: «нет данных»).
 *
 * `alertGoals` — цели с `cachedAlignmentDelta <= -15 AND cachedAlignment <= 60`.
 * UI подсвечивает их в красной рамке.
 */
export interface DirectorDashboardAlertGoalDto {
  id: string;
  name: string;
  score: number;
  delta: number;
}

export interface DirectorDashboardStrategicAlignmentDto {
  average: number | null;
  goalsCount: number;
  alertGoals: DirectorDashboardAlertGoalDto[];
}

/**
 * Action Center B2 — блок «Требует вашего подтверждения».
 *
 * Сводка pending-подтверждений текущего пользователя (`PendingActionsService.
 * getCount`). Источники: curation (карточки знания), conflict (конфликты),
 * intake (задачи из встреч), probe (вопросы Коры). UI рисует красную плитку
 * при наличии конфликтов и янтарную в остальных случаях; при total=0 плитка
 * не показывается.
 *
 * Опциональное поле — best-effort: если сервис недоступен, дашборд не падает.
 */
export interface DirectorDashboardRequiresActionDto {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

/**
 * Goals OKR v2 Фаза 4 — узел дерева целей для дашборда.
 *
 * Дерево active+живых целей (`promotionState='active'`, `validUntil=null`,
 * `archivedAt=null`). Корни — цели с `parentGoalId=null` или чей родитель
 * не входит в набор активных целей. `keyResults[].progressPercent` —
 * clamp 0..100 от (current-start)/(target-start).
 */
export interface DirectorDashboardGoalTreeKrDto {
  id: string;
  name: string;
  /** Прогресс KR в %, 0..100 (clamp). */
  progressPercent: number;
  /** Единица измерения KR (для UI). null — без числа. */
  unit: string | null;
}

export interface DirectorDashboardGoalTreeNodeDto {
  id: string;
  name: string;
  /** Жизненный цикл (GoalStatus): active|paused|achieved|abandoned. */
  status: string;
  /** Ось движения для пульса (GoalProgressStatus). */
  progressStatus: string;
  /** Кэш «движения к цели» 0..100. null — ещё не считалось. */
  cachedAlignment: number | null;
  /** Вес цели в среднем «Согласованность стратегии». */
  weight: number;
  parentGoalId: string | null;
  keyResults: DirectorDashboardGoalTreeKrDto[];
  children: DirectorDashboardGoalTreeNodeDto[];
}

/**
 * Goals OKR v2 Фаза 4 — счётчики недели по progressStatus для виджета
 * «Пульс целей» на дашборде.
 */
export interface DirectorDashboardGoalsPulseDto {
  onTrackCount: number;
  atRiskCount: number;
  stalledCount: number;
  achievedCount: number;
  droppedCount: number;
  total: number;
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
  narrativeSummary: NarrativeSummaryDto | null;
  /** KPI-hero «Индекс настроения недели». ТЗ §1.5. */
  kpiSentimentIndex: DirectorDashboardKpiDto;
  /** KPI-hero «Обещания (надёжность)». ТЗ §1.5. */
  kpiCommitmentReliability: DirectorDashboardKpiDto;
  /** KPI-hero «Висящие решения». ТЗ §1.5. */
  kpiHangingDecisions: DirectorDashboardKpiDto;
  /** Phase 9: блок «Согласованность стратегии». Опциональный для backward
   *  compatibility — на проде Фаза 8 уже задеплоена без него. */
  strategicAlignment?: DirectorDashboardStrategicAlignmentDto;
  /** Action Center B2: блок «Требует вашего подтверждения» (per-user).
   *  Опциональный — best-effort, не валит дашборд при ошибке сервиса. */
  requiresAction?: DirectorDashboardRequiresActionDto;
  /** Goals OKR v2 Фаза 4: дерево active-целей с KR-прогрессом и progressStatus.
   *  Опциональный для backward-compat (как strategicAlignment). */
  goalsTree?: DirectorDashboardGoalTreeNodeDto[];
  /** Goals OKR v2 Фаза 4: счётчики недели по progressStatus для виджета «Пульс
   *  целей». Опциональный для backward-compat. */
  goalsPulse?: DirectorDashboardGoalsPulseDto;
  /**
   * true — у tenant ещё нет реальных данных (0 сигналов и 0 тем за период).
   * В этом случае все массивы заполнены **синтетическим** примером (sample
   * story), а frontend рисует watermark «образец». См. §1.2 ТЗ «Пульс
   * компании» (plans/tz/2026-05-30-pulse-full.md).
   */
  isEmpty: boolean;
  /**
   * ТЗ-2 Ф1 — «Полоса пользы»: 5 твёрдых счётчиков за период. Считается
   * всегда (в т.ч. для пустого tenant'а — там нули или sample-значения).
   */
  valueStrip: DirectorDashboardValueStripDto;
  /**
   * ТЗ-2 Ф1 — kill-switch новой компоновки главной директора
   * (`dashboard.main_rework.enabled`, default ON). Frontend выбирает раскладку
   * первого экрана; на backend ничего не гейтит — `valueStrip` считается всегда.
   */
  mainReworkEnabled: boolean;
  /**
   * Б-1 устойчивость — true, если хотя бы один виджет не загрузился (ошибка БД)
   * и заменён нейтральным fallback'ом. Дашборд при этом всё равно отдаётся (200),
   * а не падает в 500. Frontend может показать ненавязчивую плашку «часть
   * данных не загрузилась». Опциональное — backward-compat.
   */
  degraded?: boolean;
}
