import {
  parseBranchSafe,
  type ThemeBranch,
  type ThemeDynamic,
} from "@/domain/theme";
import type {
  GoalProgressStatus,
  GoalStatus,
  GoalTreeRenderNode,
} from "@/domain/goal";

export type SignalType =
  | "pain"
  | "feature_request"
  | "churn_risk"
  | "objection"
  | "risk"
  | "decision"
  | "commitment"
  | "mood"
  | "drift"
  | "competitor_move"
  | "metric_change"
  | "idea"
  | "fact"
  | "knowledge_gap"
  | "reasoning"
  | "rationale"
  | "decision_basis"
  | "regulation"
  | "process_step";

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  pain: "Боль клиента",
  feature_request: "Запрос фичи",
  churn_risk: "Риск ухода клиента",
  objection: "Возражение",
  risk: "Риск",
  decision: "Решение",
  commitment: "Обязательство",
  mood: "Настроение",
  drift: "Отклонение",
  competitor_move: "Действие конкурента",
  metric_change: "Изменение метрики",
  idea: "Идея",
  fact: "Факт",
  knowledge_gap: "Открытый вопрос",
  reasoning: "Обоснование",
  rationale: "Логика решения",
  decision_basis: "Основание решения",
  regulation: "Регламент",
  process_step: "Шаг процесса",
};

export function signalTypeLabel(raw: string): string {
  if (raw in SIGNAL_TYPE_LABELS) {
    return SIGNAL_TYPE_LABELS[raw as SignalType];
  }
  return raw;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  client: "Клиент",
  person: "Человек",
  product: "Продукт",
  project: "Проект",
  partner: "Партнёр",
  competitor: "Конкурент",
  vendor: "Поставщик",
  region: "Регион",
  metric: "Метрика",
  technology: "Технология",
  team: "Команда",
  other: "Другое",
};

export function entityTypeLabel(raw: string): string {
  return ENTITY_TYPE_LABELS[raw] ?? raw;
}

const KNOWN_DYNAMICS: ReadonlySet<string> = new Set([
  "growing",
  "stable",
  "declining",
]);

function parseDynamic(raw: string): ThemeDynamic {
  return KNOWN_DYNAMICS.has(raw) ? (raw as ThemeDynamic) : "stable";
}

export type DirectorDashboardPeriod = "week" | "month";

export type DirectorDashboardThemeApi = {
  id: string;
  name: string;
  branch: string | null;
  weight: number;
  dynamic: "growing" | "stable" | "declining";
  blocksCount: number;
  lastSignalAt: string | null;
};

export type DirectorDashboardSignalReasonRefApi = {
  meetingId?: string;
  meetingTitle?: string;
  decisionId?: string;
};

export type DirectorDashboardSignalApi = {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  evidenceMeetingId: string | null;
  reasonSourceRef?: DirectorDashboardSignalReasonRefApi | null;
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

export type DirectorDashboardRequiresActionApi = {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
};

export type DirectorDashboardRequiresActionDomain =
  DirectorDashboardRequiresActionApi;

export type GoalTreeNodeKeyResultApi = {
  id: string;
  name: string;
  progressPercent: number;
  unit: string | null;
};

export type GoalTreeNodeApi = {
  id: string;
  name: string;
  status: "active" | "paused" | "achieved" | "abandoned";
  progressStatus: "on_track" | "at_risk" | "stalled" | "achieved" | "dropped";
  cachedAlignment: number | null;
  weight: number;
  parentGoalId: string | null;
  keyResults: GoalTreeNodeKeyResultApi[];
  children: GoalTreeNodeApi[];
};

export type GoalsPulseApi = {
  onTrackCount: number;
  atRiskCount: number;
  stalledCount: number;
  achievedCount: number;
  droppedCount: number;
  total: number;
};

export type CitationType = "ib" | "theme" | "ent" | "mtg" | "goal" | "dec";

export type CitationApi = {
  number: number;
  type: CitationType;
  id: string;
  label: string;
  url: string | null;
};

export type NarrativeSummaryApi = {
  text: string;
  citations: CitationApi[];
};

export type CitationDomain = CitationApi;
export type NarrativeSummaryDomain = NarrativeSummaryApi;

export type DirectorDashboardKpiApi = {
  value: number;
  sparkline: Array<number | null>;
  delta: number | null;
  trend?: "up" | "flat" | "down";
};

export type DirectorDashboardKpiDomain = DirectorDashboardKpiApi;

export type DirectorDashboardValueStripApi = {
  meetingsProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  questionsAnsweredByMemory: number;
  tasksResolved: number;
  ideasCollected: number;
};

export type DirectorDashboardValueStripDomain = DirectorDashboardValueStripApi;

export type DirectorDashboardApi = {
  period: DirectorDashboardPeriod;
  generatedAt: string;
  newThemes: DirectorDashboardThemeApi[];
  newSignals: DirectorDashboardSignalApi[];
  signalCounters: DirectorDashboardSignalCountersApi;
  activeThemes: DirectorDashboardThemeApi[];
  hotEntities: DirectorDashboardEntityApi[];
  openQuestions: DirectorDashboardOpenQuestionApi[];
  narrativeSummary: NarrativeSummaryApi | null;
  kpiSentimentIndex?: DirectorDashboardKpiApi;
  strategicAlignment?: DirectorDashboardStrategicAlignmentApi;
  requiresAction?: DirectorDashboardRequiresActionApi;
  goalsTree?: GoalTreeNodeApi[];
  goalsPulse?: GoalsPulseApi;
  isEmpty?: boolean;
  valueStrip?: DirectorDashboardValueStripApi;
  mainReworkEnabled?: boolean;
  degraded?: boolean;
};

export type DirectorDashboardThemeDomain = {
  id: string;
  name: string;
  branch: ThemeBranch | null;
  weight: number;
  dynamic: ThemeDynamic;
  blocksCount: number;
  lastSignalAt: Date | null;
};

export type DirectorDashboardSignalReasonRefDomain =
  DirectorDashboardSignalReasonRefApi;

export type DirectorDashboardSignalDomain = {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  criticalQuestion: string;
  trustedAnswer: string;
  evidenceMeetingId: string | null;
  reasonSourceRef: DirectorDashboardSignalReasonRefDomain | null;
};

export type DirectorDashboardSignalCountersDomain =
  DirectorDashboardSignalCountersApi;

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

export type GoalTreeNodeKeyResultDomain = {
  id: string;
  name: string;
  progressPercent: number;
  unit: string | null;
};

export type GoalTreeNodeDomain = {
  id: string;
  name: string;
  status: GoalStatus;
  progressStatus: GoalProgressStatus;
  cachedAlignment: number | null;
  weight: number;
  parentGoalId: string | null;
  keyResults: GoalTreeNodeKeyResultDomain[];
  children: GoalTreeNodeDomain[];
};

export type GoalsPulseDomain = {
  onTrackCount: number;
  atRiskCount: number;
  stalledCount: number;
  achievedCount: number;
  droppedCount: number;
  total: number;
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
  narrativeSummary: NarrativeSummaryDomain | null;
  kpiSentimentIndex: DirectorDashboardKpiDomain | null;
  strategicAlignment: DirectorDashboardStrategicAlignmentDomain | null;
  requiresAction: DirectorDashboardRequiresActionDomain | null;
  goalsTree: GoalTreeNodeDomain[] | null;
  goalsPulse: GoalsPulseDomain | null;
  isEmpty: boolean;
  valueStrip: DirectorDashboardValueStripDomain;
  mainReworkEnabled: boolean;
  degraded: boolean;
};

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
    reasonSourceRef: api.reasonSourceRef ?? null,
  };
}

const EMPTY_VALUE_STRIP: DirectorDashboardValueStripDomain = {
  meetingsProtocoled: 0,
  tasksExtracted: 0,
  decisionsExtracted: 0,
  questionsAnsweredByMemory: 0,
  tasksResolved: 0,
  ideasCollected: 0,
};

function valueStripFromApi(
  api: DirectorDashboardValueStripApi | undefined,
): DirectorDashboardValueStripDomain {
  if (!api) return EMPTY_VALUE_STRIP;
  return {
    meetingsProtocoled: api.meetingsProtocoled ?? 0,
    tasksExtracted: api.tasksExtracted ?? 0,
    decisionsExtracted: api.decisionsExtracted ?? 0,
    questionsAnsweredByMemory: api.questionsAnsweredByMemory ?? 0,
    tasksResolved: api.tasksResolved ?? 0,
    ideasCollected: api.ideasCollected ?? 0,
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

const KNOWN_GOAL_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "paused",
  "achieved",
  "abandoned",
]);

function parseGoalStatus(raw: string): GoalStatus {
  return KNOWN_GOAL_STATUSES.has(raw) ? (raw as GoalStatus) : "active";
}

const KNOWN_GOAL_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "on_track",
  "at_risk",
  "stalled",
  "achieved",
  "dropped",
]);

function parseGoalProgressStatus(raw: string): GoalProgressStatus {
  return KNOWN_GOAL_PROGRESS_STATUSES.has(raw)
    ? (raw as GoalProgressStatus)
    : "on_track";
}

export function goalTreeNodeFromApi(api: GoalTreeNodeApi): GoalTreeNodeDomain {
  return {
    id: api.id,
    name: api.name,
    status: parseGoalStatus(api.status),
    progressStatus: parseGoalProgressStatus(api.progressStatus),
    cachedAlignment: api.cachedAlignment,
    weight: api.weight,
    parentGoalId: api.parentGoalId,
    keyResults: Array.isArray(api.keyResults)
      ? api.keyResults.map((kr) => ({
          id: kr.id,
          name: kr.name,
          progressPercent: kr.progressPercent,
          unit: kr.unit,
        }))
      : [],
    children: Array.isArray(api.children)
      ? api.children.map(goalTreeNodeFromApi)
      : [],
  };
}

export function goalTreeNodeToRenderNode(
  node: GoalTreeNodeDomain,
): GoalTreeRenderNode {
  return {
    id: node.id,
    name: node.name,
    progressStatus: node.progressStatus,
    cachedAlignment: node.cachedAlignment,
    keyResults: node.keyResults.map((kr) => ({
      id: kr.id,
      name: kr.name,
      progressPercent: kr.progressPercent,
      unit: kr.unit,
    })),
    children: node.children.map(goalTreeNodeToRenderNode),
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
    kpiSentimentIndex: api.kpiSentimentIndex ?? null,
    strategicAlignment: api.strategicAlignment
      ? strategicAlignmentFromApi(api.strategicAlignment)
      : null,
    requiresAction: api.requiresAction
      ? {
          total: api.requiresAction.total,
          bySource: {
            curation: api.requiresAction.bySource?.curation ?? 0,
            conflict: api.requiresAction.bySource?.conflict ?? 0,
            intake: api.requiresAction.bySource?.intake ?? 0,
            probe: api.requiresAction.bySource?.probe ?? 0,
          },
        }
      : null,
    goalsTree: api.goalsTree ? api.goalsTree.map(goalTreeNodeFromApi) : null,
    goalsPulse: api.goalsPulse ?? null,
    isEmpty: api.isEmpty ?? false,
    valueStrip: valueStripFromApi(api.valueStrip),
    mainReworkEnabled: api.mainReworkEnabled ?? true,
    degraded: api.degraded ?? false,
  };
}

export type RequiresActionTone = "none" | "danger" | "accent";

export function requiresActionTone(
  ra: DirectorDashboardRequiresActionDomain | null | undefined,
): RequiresActionTone {
  if (!ra || ra.total <= 0) return "none";
  if (ra.bySource.conflict > 0) return "danger";
  return "accent";
}

export type SignalCountersBucketKey = keyof DirectorDashboardSignalCountersApi;
