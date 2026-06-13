/**
 * ТЗ Ф8.7 (cabinet-redesign-rhythms) — доменная модель «Дисциплина чек-инов».
 *
 * Маппит ApiDto → Domain. Структурно совпадает с API DTO (числа + строки уже
 * готовы к рендеру), поэтому маппер — identity с защитными дефолтами для
 * backward-compat (старый backend без поля → нули, `enabled=false`).
 *
 * Контракт ApiDto — `frontend/src/api/operations-dashboard.api.ts`.
 */

import type {
  CheckinDisciplineApi,
  CheckinDisciplinePersonApi,
  CheckinDisciplineTotalsApi,
} from '@/api/operations-dashboard.api';

export interface CheckinDisciplineTotalsDomain
  extends CheckinDisciplineTotalsApi {}

export interface CheckinDisciplinePersonDomain
  extends CheckinDisciplinePersonApi {}

export interface CheckinDisciplineDomain {
  from: string;
  to: string;
  enabled: boolean;
  totals: CheckinDisciplineTotalsDomain;
  byPerson: CheckinDisciplinePersonDomain[];
}

const EMPTY_TOTALS: CheckinDisciplineTotalsDomain = {
  morningExpected: 0,
  morningCompleted: 0,
  morningMissed: 0,
  eveningExpected: 0,
  eveningCompleted: 0,
  eveningMissed: 0,
  completionRate: null,
};

export function fromCheckinDisciplineApi(
  dto: CheckinDisciplineApi,
): CheckinDisciplineDomain {
  return {
    from: dto.from,
    to: dto.to,
    enabled: dto.enabled ?? false,
    totals: dto.totals ?? EMPTY_TOTALS,
    byPerson: Array.isArray(dto.byPerson) ? dto.byPerson : [],
  };
}

/** YYYY-MM-DD по локальной дате (для плашки «Сегодня»: from=to=сегодня). */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
