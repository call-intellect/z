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
