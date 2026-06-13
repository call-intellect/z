/**
 * ТЗ-2 Ф6.C / S1.5 (daily-value-engine) — доменная модель витрины
 * «Что сделала Кора» (value-recap).
 *
 * Маппит ApiDto в DomainModel, даёт RU-подписи счётчиков «снятой рутины» и
 * слоя «команда лучше», форматирует дельты и период (YYYY-MM → «июнь 2026»).
 *
 * Честность (Р6/Р7): здесь НЕТ «часы×ставка→₽», НЕТ «до Коры» — только то, что
 * пришло в payload. Soft-слой подписан «оценка» (team.estimate=true).
 */

import type {
  ValueRecapDecisionApi,
  ValueRecapDecisionStatus,
  ValueRecapDeltaApi,
  ValueRecapPayloadApi,
  ValueRecapRoutineApi,
  ValueRecapSnapshotApi,
  ValueRecapTeamApi,
} from '@/api/value-recap.api';

// ─── RU-подписи «снятой рутины» ──────────────────────────────────────────────

/** Ключи счётчиков «снятой рутины» в порядке отображения. */
export const VALUE_RECAP_ROUTINE_ORDER: readonly (keyof ValueRecapRoutineApi)[] =
  [
    'meetingsAutoProtocoled',
    'tasksExtracted',
    'decisionsExtracted',
    'commitmentsExtracted',
    'statusesCollected',
    'questionsAnsweredWithCitation',
    'ideasShipped',
  ] as const;

export const VALUE_RECAP_ROUTINE_LABELS: Record<
  keyof ValueRecapRoutineApi,
  string
> = {
  meetingsAutoProtocoled: 'встреч запротоколировано',
  tasksExtracted: 'задач',
  decisionsExtracted: 'решений',
  commitmentsExtracted: 'договорённостей',
  statusesCollected: 'статусов собрано',
  questionsAnsweredWithCitation: 'ответов с источником',
  ideasShipped: 'идей внедрено',
};

// ─── Форматтеры ──────────────────────────────────────────────────────────────

const RU_MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

/** «2026-06» → «июнь 2026». При нераспознанном формате — как есть. */
export function formatPeriodYm(periodYm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const month = RU_MONTHS[monthIdx];
  if (!month) return periodYm;
  return `${month} ${year}`;
}

/** Сдвиг периода YYYY-MM на ±1 месяц. */
export function shiftPeriodYm(periodYm: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = Number(m[1]);
  const monthIdx0 = Number(m[2]) - 1; // 0..11
  const total = year * 12 + monthIdx0 + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1; // 1..12
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

/** Прошлый месяц как YYYY-MM (UTC-устойчиво по компонентам). */
export function prevMonthYm(now: Date = new Date()): string {
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return shiftPeriodYm(cur, -1);
}

/** Дельта счётчика: «↑ N / ↓ N / без изменений» или null если delta null. */
export function deltaLabel(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;
  if (delta === 0) return 'без изменений';
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(delta)}`;
}

/** Тон дельты: рост вверх / падение вниз / нейтрально. */
export function deltaTone(
  delta: number | null | undefined,
): 'up' | 'down' | 'flat' | null {
  if (delta === null || delta === undefined) return null;
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

// ─── Domain-модель ───────────────────────────────────────────────────────────

/** Одна ячейка «снятой рутины»: значение + RU-подпись + дельта. */
export interface ValueRecapRoutineCell {
  key: keyof ValueRecapRoutineApi;
  label: string;
  value: number;
  deltaText: string | null;
  deltaTone: 'up' | 'down' | 'flat' | null;
}

// ─── Решения месяца ───────────────────────────────────────────────────────────

/** RU-подпись статуса доведения решения. */
export const VALUE_RECAP_DECISION_STATUS_LABELS: Record<
  ValueRecapDecisionStatus,
  string
> = {
  done: 'внедрено',
  in_progress: 'в работе',
  stalled: 'застряло',
  not_started: 'не начато',
};

/**
 * Тон статуса (для парных цветовых токенов): внедрено→ok, в работе→info,
 * застряло/не начато→warning. Маппится на STATUS_TONE/CHART в UI.
 */
export function decisionStatusTone(
  status: ValueRecapDecisionStatus,
): 'ok' | 'info' | 'warning' {
  switch (status) {
    case 'done':
      return 'ok';
    case 'in_progress':
      return 'info';
    case 'stalled':
    case 'not_started':
    default:
      return 'warning';
  }
}

/**
 * Тон прогресс-бара доведения по проценту (как в прототипе): ≥80→teal,
 * ≥40→warn, иначе risk.
 */
export function decisionProgressTone(
  percent: number,
): 'teal' | 'warn' | 'risk' {
  if (percent >= 80) return 'teal';
  if (percent >= 40) return 'warn';
  return 'risk';
}

/** Одно решение месяца в доменном виде (с RU-подписью и тонами). */
export interface ValueRecapDecision {
  id: string;
  statement: string;
  status: ValueRecapDecisionStatus;
  statusLabel: string;
  statusTone: 'ok' | 'info' | 'warning';
  throughputPercent: number;
  progressTone: 'teal' | 'warn' | 'risk';
}

/** Разбивка решений по статусам — для крупной карточки-итога. */
export interface ValueRecapDecisionBreakdown {
  done: number;
  inProgress: number;
  stalled: number;
  notStarted: number;
}

function mapDecisions(
  decisions: ValueRecapDecisionApi[],
): ValueRecapDecision[] {
  return decisions.map((d) => ({
    id: d.id,
    statement: d.statement,
    status: d.status,
    statusLabel: VALUE_RECAP_DECISION_STATUS_LABELS[d.status],
    statusTone: decisionStatusTone(d.status),
    throughputPercent: Math.max(0, Math.min(100, Math.round(d.throughputPercent))),
    progressTone: decisionProgressTone(d.throughputPercent),
  }));
}

function decisionBreakdown(
  decisions: ValueRecapDecision[],
): ValueRecapDecisionBreakdown {
  return decisions.reduce<ValueRecapDecisionBreakdown>(
    (acc, d) => {
      if (d.status === 'done') acc.done += 1;
      else if (d.status === 'in_progress') acc.inProgress += 1;
      else if (d.status === 'stalled') acc.stalled += 1;
      else acc.notStarted += 1;
      return acc;
    },
    { done: 0, inProgress: 0, stalled: 0, notStarted: 0 },
  );
}

export interface ValueRecapDomain {
  id: string;
  periodYm: string;
  periodLabel: string;
  /** Снимок есть, но payload ещё не собран (null) — empty-state. */
  hasPayload: boolean;
  isBaseline: boolean;
  builtAt: Date | null;
  routineCells: ValueRecapRoutineCell[];
  team: ValueRecapTeamApi | null;
  delta: ValueRecapDeltaApi | null;
  /** Топ-10 решений месяца (со статусом и % доведения). */
  decisions: ValueRecapDecision[];
  /** Разбивка решений по статусам (для крупной карточки-итога). */
  decisionBreakdown: ValueRecapDecisionBreakdown;
  narrative: string;
}

function routineCells(
  routine: ValueRecapRoutineApi,
  delta: ValueRecapDeltaApi | null,
): ValueRecapRoutineCell[] {
  return VALUE_RECAP_ROUTINE_ORDER.map((key) => {
    const d = delta ? delta[key] : null;
    return {
      key,
      label: VALUE_RECAP_ROUTINE_LABELS[key],
      value: routine[key] ?? 0,
      deltaText: deltaLabel(d),
      deltaTone: deltaTone(d),
    };
  });
}

export function valueRecapFromApi(
  api: ValueRecapSnapshotApi,
): ValueRecapDomain {
  const payload: ValueRecapPayloadApi | null = api.payload;
  const decisions = payload ? mapDecisions(payload.decisions ?? []) : [];
  return {
    id: api.id,
    periodYm: api.periodYm,
    periodLabel: formatPeriodYm(api.periodYm),
    hasPayload: payload !== null,
    isBaseline: payload?.isBaseline ?? false,
    builtAt: payload?.builtAt ? new Date(payload.builtAt) : null,
    routineCells: payload ? routineCells(payload.routine, payload.delta) : [],
    team: payload?.team ?? null,
    delta: payload?.delta ?? null,
    decisions,
    decisionBreakdown: decisionBreakdown(decisions),
    narrative: payload?.narrative ?? '',
  };
}

// ─── Подписи soft-слоя «команда лучше» ────────────────────────────────────────

/** «N% (из M)» или «мало данных», когда percent null. */
export function reliabilityText(team: ValueRecapTeamApi): string {
  if (team.reliabilityPercent === null) return 'мало данных';
  return `${Math.round(team.reliabilityPercent)}% (из ${team.reliabilityDenominator})`;
}

/** «N% (из M оценок)» или «мало оценок», когда percent null. */
export function chatHelpedText(team: ValueRecapTeamApi): string {
  if (team.chatHelpedRatePercent === null) return 'мало оценок';
  return `${Math.round(team.chatHelpedRatePercent)}% (из ${team.chatRated} оценок)`;
}

/** «N% доведено (из M решений)». */
export function decisionsThroughputText(team: ValueRecapTeamApi): string {
  return `${Math.round(team.decisionsThroughputPercent)}% доведено (из ${team.decisionsTotal} решений)`;
}
