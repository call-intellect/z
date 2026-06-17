export interface ValueRecapRoutine {
  meetingsAutoProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  commitmentsExtracted: number;
  statusesCollected: number;
  questionsAnsweredWithCitation: number;
  ideasShipped: number;
}

export interface ValueRecapTeam {
  reliabilityPercent: number | null;
  reliabilityDenominator: number;
  reliabilityDelta: number | null;
  chatHelpedRatePercent: number | null;
  chatRated: number;
  chatAnsweredWithCitation: number;
  decisionsTotal: number;
  decisionsThroughputPercent: number;
  ideasShipped: number;
  estimate: true;
}

export interface ValueRecapDecision {
  id: string;
  statement: string;
  status: string;
  throughputPercent: number;
}

export interface ValueRecapDelta {
  meetingsAutoProtocoled: number | null;
  tasksExtracted: number | null;
  decisionsExtracted: number | null;
  commitmentsExtracted: number | null;
  statusesCollected: number | null;
  questionsAnsweredWithCitation: number | null;
  ideasShipped: number | null;
}

export interface ValueRecapPayload {
  periodYm: string;
  builtAt: string;
  isBaseline: boolean;
  routine: ValueRecapRoutine;
  team: ValueRecapTeam;
  delta: ValueRecapDelta | null;
  decisions: ValueRecapDecision[];
  narrative: string;
}

export const FORBIDDEN_METRIC_KEY_SUBSTRINGS: readonly string[] = [
  'rubles',
  'rubl',
  'kopeck',
  'kopek',
  'money',
  'hourlyrate',
  'hourrate',
  'raterub',
  'costrate',
  'hourssaved',
  'savedhours',
  'savedrub',
  'savedmoney',
  'savedcost',
  'medianhourstoanswer',
  'roiscore',
  'alignmentscore',
  'beforeafter',
  'knowledgesaved',
];

export function findForbiddenMetricKeys(payload: unknown): string[] {
  const allow = new Set([
    'helpedrate',
    'helpedratepercent',
    'feedbackcoveragepercent',
    'groundedratepercent',
    'helpedratehidden',
    'reliabilitypercent',
    'reliabilitydelta',
    'reliabilitydenominator',
    'throughputpercent',
    'decisionsthroughputpercent',
    'estimate',
  ]);
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const norm = key.toLowerCase().replace(/[^a-z]/g, '');
      if (!allow.has(norm)) {
        for (const bad of FORBIDDEN_METRIC_KEY_SUBSTRINGS) {
          if (norm.includes(bad)) {
            found.add(key);
            break;
          }
        }
      }
      visit(value);
    }
  };
  visit(payload);
  return [...found];
}

export function assertNoForbiddenMetricKeys(payload: unknown): void {
  const bad = findForbiddenMetricKeys(payload);
  if (bad.length > 0) {
    throw new Error(
      `value-recap: payload содержит запрещённые наружу метрики (Р6): ${bad.join(', ')}`,
    );
  }
}

export function computeCounterDelta(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  return nonNeg(current) - nonNeg(previous);
}

export function buildDelta(
  current: ValueRecapRoutine,
  previous: ValueRecapRoutine | null,
): ValueRecapDelta | null {
  if (!previous) return null;
  return {
    meetingsAutoProtocoled: computeCounterDelta(
      current.meetingsAutoProtocoled,
      previous.meetingsAutoProtocoled,
    ),
    tasksExtracted: computeCounterDelta(current.tasksExtracted, previous.tasksExtracted),
    decisionsExtracted: computeCounterDelta(
      current.decisionsExtracted,
      previous.decisionsExtracted,
    ),
    commitmentsExtracted: computeCounterDelta(
      current.commitmentsExtracted,
      previous.commitmentsExtracted,
    ),
    statusesCollected: computeCounterDelta(current.statusesCollected, previous.statusesCollected),
    questionsAnsweredWithCitation: computeCounterDelta(
      current.questionsAnsweredWithCitation,
      previous.questionsAnsweredWithCitation,
    ),
    ideasShipped: computeCounterDelta(current.ideasShipped, previous.ideasShipped),
  };
}

export function assembleValueRecapPayload(args: {
  periodYm: string;
  builtAt: Date;
  routine: ValueRecapRoutine;
  team: ValueRecapTeam;
  previousRoutine: ValueRecapRoutine | null;
  decisions: ValueRecapDecision[];
  narrative: string;
}): ValueRecapPayload {
  const isBaseline = args.previousRoutine === null;
  const payload: ValueRecapPayload = {
    periodYm: args.periodYm,
    builtAt: args.builtAt.toISOString(),
    isBaseline,
    routine: args.routine,
    team: args.team,
    delta: buildDelta(args.routine, args.previousRoutine),
    decisions: args.decisions ?? [],
    narrative: args.narrative,
  };
  assertNoForbiddenMetricKeys(payload);
  return payload;
}

function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
