/**
 * Доменные модели self-scope виджетов «ежедневной ценности» в `/me`
 * (ТЗ-2 Ф5 daily-value-dashboards).
 *
 * Слои:
 *   - `*Api` — что приходит с бэка (см. `src/api/me-daily-value.api.ts`).
 *   - `*Domain` — UI-friendly: Date вместо string, готовые RU-лейблы.
 *
 * Контракт бэка: `backend/.../dto/my-daily-value.dto.ts`,
 * `backend/.../dto/weekly-per-person.dto.ts`.
 */

import type {
  MyRecognitionApi,
  MyWeeklyPerPersonApi,
  MyWeeklyPersonRowApi,
} from '@/api/me-daily-value.api';

// ─── Признания ──────────────────────────────────────────────────────

/**
 * RU-лейблы типов признания. Значения `type` приходят с бэка как строки
 * (Recognition.type). Незнакомый тип отрендерим «как есть» через fallback.
 */
export const RECOGNITION_TYPE_LABEL: Record<string, string> = {
  thanks_comment: 'спасибо за комментарий',
  thanks_helpfulness: 'спасибо за помощь',
  mention_helped: 'отметили, что помог',
  idea_shipped: 'идея реализована',
  streak_milestone: 'серия достижений',
  weekly_summary: 'итоги недели',
};

export function recognitionTypeLabel(type: string): string {
  return RECOGNITION_TYPE_LABEL[type] ?? type;
}

export interface MyRecognitionDomain {
  id: string;
  type: string;
  /** Готовый RU-лейбл типа (или сам `type`, если карта его не знает). */
  typeLabel: string;
  message: string | null;
  fromPersonName: string | null;
  visibility: string;
  createdAt: Date;
}

export function mapMyRecognition(api: MyRecognitionApi): MyRecognitionDomain {
  return {
    id: api.id,
    type: api.type,
    typeLabel: recognitionTypeLabel(api.type),
    message: api.message,
    fromPersonName: api.fromPersonName,
    visibility: api.visibility,
    createdAt: new Date(api.createdAt),
  };
}

// ─── Недельный план-факт (self) ─────────────────────────────────────

export interface MyWeeklySelfRowDomain {
  personId: string;
  personName: string;
  departmentName: string | null;
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  promisesNoAnswer: number;
  reliabilityPercent: number | null;
  tasksDone: number;
  checkInsCompleted: number;
  /**
   * Знаменатель надёжности (kept+broken+overdue). Считаем на фронте, чтобы
   * отличить «мало данных» (denom>0, но reliabilityPercent=null) от «совсем
   * нет обещаний» (denom=0).
   */
  reliabilityDenominator: number;
}

export interface MyWeeklySelfDomain {
  weekStart: string;
  weekEnd: string;
  row: MyWeeklySelfRowDomain | null;
  teamAverageReliabilityPercent: number | null;
}

function mapMyWeeklyRow(api: MyWeeklyPersonRowApi): MyWeeklySelfRowDomain {
  return {
    personId: api.personId,
    personName: api.personName,
    departmentName: api.departmentName,
    promisesGiven: api.promisesGiven,
    promisesKept: api.promisesKept,
    promisesBroken: api.promisesBroken,
    promisesOverdue: api.promisesOverdue,
    promisesNoAnswer: api.promisesNoAnswer,
    reliabilityPercent: api.reliabilityPercent,
    tasksDone: api.tasksDone,
    checkInsCompleted: api.checkInsCompleted,
    reliabilityDenominator:
      api.promisesKept + api.promisesBroken + api.promisesOverdue,
  };
}

export function mapMyWeeklySelf(api: MyWeeklyPerPersonApi): MyWeeklySelfDomain {
  return {
    weekStart: api.weekStart,
    weekEnd: api.weekEnd,
    row: api.row ? mapMyWeeklyRow(api.row) : null,
    teamAverageReliabilityPercent: api.teamAverageReliabilityPercent,
  };
}
