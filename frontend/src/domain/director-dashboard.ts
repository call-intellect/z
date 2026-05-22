/**
 * Доменная модель дашборда директора (knowledge-core, Фаза 8).
 *
 * Источник правды:
 *   `backend/src/modules/dashboard/dto/director-dashboard.dto.ts`
 *
 * Контракт (один эндпоинт): `GET /api/v1/dashboard/director?period=week|month`.
 * UI на основе этой модели рендерит 5 виджетов + опциональный narrativeSummary
 * + (Phase 9) блок «Согласованность стратегии».
 */

import {
  parseBranchSafe,
  type ThemeBranch,
  type ThemeDynamic,
} from '@/domain/theme';

// ─── SignalType (общие лейблы) ──────────────────────────────────────────────

/**
 * Полный список значений `SignalType` enum (см. backend/prisma/schema.prisma).
 * Дашборд использует подмножество для счётчиков и фильтрации, остальные —
 * группируются в `other`.
 */
export type SignalType =
  | 'pain'
  | 'feature_request'
  | 'churn_risk'
  | 'objection'
  | 'risk'
  | 'decision'
  | 'commitment'
  | 'mood'
  | 'drift'
  | 'competitor_move'
  | 'metric_change'
  | 'idea'
  | 'fact'
  | 'knowledge_gap'
  // SBA α-2 — расширение Layer 1 разметки.
  | 'reasoning'
  | 'rationale'
  | 'decision_basis'
  | 'regulation'
  | 'process_step';

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  pain: 'Боль клиента',
  feature_request: 'Запрос фичи',
  churn_risk: 'Риск ухода клиента',
  objection: 'Возражение',
  risk: 'Риск',
  decision: 'Решение',
  commitment: 'Обязательство',
  mood: 'Настроение',
  drift: 'Отклонение',
  competitor_move: 'Действие конкурента',
  metric_change: 'Изменение метрики',
  idea: 'Идея',
  fact: 'Факт',
  knowledge_gap: 'Открытый вопрос',
  reasoning: 'Обоснование',
  rationale: 'Логика решения',
  decision_basis: 'Основание решения',
  regulation: 'Регламент',
  process_step: 'Шаг процесса',
};

export function signalTypeLabel(raw: string): string {
  if (raw in SIGNAL_TYPE_LABELS) {
    return SIGNAL_TYPE_LABELS[raw as SignalType];
  }
  return raw;
}

// ─── EntityType (общие лейблы) ──────────────────────────────────────────────

const ENTITY_TYPE_LABELS: Record<string, string> = {
  client: 'Клиент',
  person: 'Человек',
  product: 'Продукт',
  project: 'Проект',
  partner: 'Партнёр',
  competitor: 'Конкурент',
  vendor: 'Поставщик',
  region: 'Регион',
  metric: 'Метрика',
  technology: 'Технология',
  team: 'Команда',
  other: 'Другое',
};

export function entityTypeLabel(raw: string): string {
  return ENTITY_TYPE_LABELS[raw] ?? raw;
}

// ─── ThemeDynamic helper (повторно использует enum из theme.ts) ─────────────

const KNOWN_DYNAMICS: ReadonlySet<string> = new Set([
  'growing',
  'stable',
  'declining',
]);

function parseDynamic(raw: string): ThemeDynamic {
  return KNOWN_DYNAMICS.has(raw) ? (raw as ThemeDynamic) : 'stable';
}

// ─── API DTO (зеркало backend) ──────────────────────────────────────────────

export type DirectorDashboardPeriod = 'week' | 'month';

export type DirectorDashboardThemeApi = {
  id: string;
  name: string;
  branch: string | null;
  weight: number;
  dynamic: 'growing' | 'stable' | 'declining';
  blocksCount: number;
  /** Только для `activeThemes`. Для `newThemes` всегда `null`. */
  lastSignalAt: string | null;
};

export type DirectorDashboardSignalApi = {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  evidenceMeetingId: string | null;
};

export type DirectorDashboardSignalCountersApi = {
  pain: number;
  feature_request: number;
  churn_risk: number;
  objection: number;
  risk: number;
  decision: number;
  commitment: number;
  other: number;
};

export type DirectorDashboardEntityApi = {
  id: string;
  canonicalName: string;
  type: string;
  recentMentions: number;
};

export type DirectorDashboardOpenQuestionApi = {
  id: string;
  name: string;
  criticalQuestion: string;
  createdAt: string;
};

export type DirectorDashboardAlertGoalApi = {
  id: string;
  name: string;
  score: number;
  delta: number;
};

export type DirectorDashboardStrategicAlignmentApi = {
  average: number | null;
  goalsCount: number;
  alertGoals: DirectorDashboardAlertGoalApi[];
};

export type DirectorDashboardApi = {
  period: DirectorDashboardPeriod;
  generatedAt: string;
  newThemes: DirectorDashboardThemeApi[];
  newSignals: DirectorDashboardSignalApi[];
  signalCounters: DirectorDashboardSignalCountersApi;
  activeThemes: DirectorDashboardThemeApi[];
  hotEntities: DirectorDashboardEntityApi[];
  openQuestions: DirectorDashboardOpenQuestionApi[];
  narrativeSummary: string | null;
  strategicAlignment?: DirectorDashboardStrategicAlignmentApi;
};

// ─── Domain-модели ──────────────────────────────────────────────────────────

export type DirectorDashboardThemeDomain = {
  id: string;
  name: string;
  branch: ThemeBranch | null;
  weight: number;
  dynamic: ThemeDynamic;
  blocksCount: number;
  lastSignalAt: Date | null;
};

export type DirectorDashboardSignalDomain = {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  evidenceMeetingId: string | null;
};

export type DirectorDashboardSignalCountersDomain = DirectorDashboardSignalCountersApi;

export type DirectorDashboardEntityDomain = {
  id: string;
  canonicalName: string;
  type: string;
  recentMentions: number;
};

export type DirectorDashboardOpenQuestionDomain = {
  id: string;
  name: string;
  criticalQuestion: string;
  createdAt: Date;
};

export type DirectorDashboardAlertGoalDomain = {
  id: string;
  name: string;
  score: number;
  delta: number;
};

export type DirectorDashboardStrategicAlignmentDomain = {
  average: number | null;
  goalsCount: number;
  alertGoals: DirectorDashboardAlertGoalDomain[];
};

export type DirectorDashboardDomain = {
  period: DirectorDashboardPeriod;
  generatedAt: Date;
  newThemes: DirectorDashboardThemeDomain[];
  newSignals: DirectorDashboardSignalDomain[];
  signalCounters: DirectorDashboardSignalCountersDomain;
  activeThemes: DirectorDashboardThemeDomain[];
  hotEntities: DirectorDashboardEntityDomain[];
  openQuestions: DirectorDashboardOpenQuestionDomain[];
  narrativeSummary: string | null;
  strategicAlignment: DirectorDashboardStrategicAlignmentDomain | null;
};

// ─── Mappers ────────────────────────────────────────────────────────────────

function themeFromApi(
  api: DirectorDashboardThemeApi,
): DirectorDashboardThemeDomain {
  return {
    id: api.id,
    name: api.name,
    branch: parseBranchSafe(api.branch),
    weight: api.weight,
    dynamic: parseDynamic(api.dynamic),
    blocksCount: api.blocksCount,
    lastSignalAt: api.lastSignalAt ? new Date(api.lastSignalAt) : null,
  };
}

function signalFromApi(
  api: DirectorDashboardSignalApi,
): DirectorDashboardSignalDomain {
  return {
    id: api.id,
    name: api.name,
    signalType: api.signalType,
    confidence: api.confidence,
    criticalQuestion: api.criticalQuestion,
    trustedAnswer: api.trustedAnswer,
    evidenceMeetingId: api.evidenceMeetingId,
  };
}

function entityFromApi(
  api: DirectorDashboardEntityApi,
): DirectorDashboardEntityDomain {
  return {
    id: api.id,
    canonicalName: api.canonicalName,
    type: api.type,
    recentMentions: api.recentMentions,
  };
}

function openQuestionFromApi(
  api: DirectorDashboardOpenQuestionApi,
): DirectorDashboardOpenQuestionDomain {
  return {
    id: api.id,
    name: api.name,
    criticalQuestion: api.criticalQuestion,
    createdAt: new Date(api.createdAt),
  };
}

function strategicAlignmentFromApi(
  api: DirectorDashboardStrategicAlignmentApi,
): DirectorDashboardStrategicAlignmentDomain {
  return {
    average: api.average,
    goalsCount: api.goalsCount,
    alertGoals: api.alertGoals.map((g) => ({
      id: g.id,
      name: g.name,
      score: g.score,
      delta: g.delta,
    })),
  };
}

export function directorDashboardFromApi(
  api: DirectorDashboardApi,
): DirectorDashboardDomain {
  return {
    period: api.period,
    generatedAt: new Date(api.generatedAt),
    newThemes: api.newThemes.map(themeFromApi),
    newSignals: api.newSignals.map(signalFromApi),
    signalCounters: api.signalCounters,
    activeThemes: api.activeThemes.map(themeFromApi),
    hotEntities: api.hotEntities.map(entityFromApi),
    openQuestions: api.openQuestions.map(openQuestionFromApi),
    narrativeSummary: api.narrativeSummary,
    strategicAlignment: api.strategicAlignment
      ? strategicAlignmentFromApi(api.strategicAlignment)
      : null,
  };
}

// ─── UI helpers (цвета сигналов, иконка для dynamic) ────────────────────────

export type SignalCountersBucketKey = keyof DirectorDashboardSignalCountersApi;

export const SIGNAL_COUNTERS_BUCKET_LABELS: Record<
  SignalCountersBucketKey,
  string
> = {
  pain: 'Боли клиентов',
  feature_request: 'Запросы фич',
  churn_risk: 'Риски ухода',
  objection: 'Возражения',
  risk: 'Риски',
  decision: 'Решения',
  commitment: 'Обязательства',
  other: 'Прочее',
};

/** Цветовые токены через tailwind классы (не зашиваем raw hex). */
export const SIGNAL_COUNTERS_BUCKET_COLORS: Record<
  SignalCountersBucketKey,
  string
> = {
  pain: 'bg-orange-500',
  churn_risk: 'bg-red-500',
  feature_request: 'bg-blue-500',
  decision: 'bg-emerald-500',
  commitment: 'bg-emerald-400',
  objection: 'bg-amber-500',
  risk: 'bg-red-400',
  other: 'bg-zinc-400',
};

/** Порядок отрисовки бакетов в гистограмме. */
export const SIGNAL_COUNTERS_BUCKET_ORDER: readonly SignalCountersBucketKey[] = [
  'pain',
  'churn_risk',
  'feature_request',
  'decision',
  'commitment',
  'objection',
  'risk',
  'other',
];
