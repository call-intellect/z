/**
 * DomainModel для `/persons/:id/pulse` — зеркало backend DTO
 * (см. `backend/src/modules/persons/services/person-pulse.service.ts`).
 *
 * Layer: `domain/` (frontend-rules). ApiDto и Domain совпадают по форме,
 * но мы сохраняем разделение для согласованности слоёв — `domain/` —
 * единственное, что компоненты импортируют.
 */

export type PersonPulseSentiment = 'green' | 'yellow' | 'red';

export type PersonPulseHrSuggestionType =
  | 'praise'
  | 'compensation_review'
  | 'workload_check'
  | 'development'
  | 'urgent_talk';

export interface PersonPulseMoodPoint {
  /** YYYY-MM-DD. */
  date: string;
  sentiment: PersonPulseSentiment | null;
  /** 0..1 или null до первого прогона Reflection-Quality-Scorer. */
  qualityScore: number | null;
}

export interface PersonPulseHrSuggestion {
  type: PersonPulseHrSuggestionType;
  text: string;
  signals: string[];
  confidence: number;
}

export interface PersonPulse {
  personId: string;
  personName: string;
  email: string;
  departmentName: string | null;
  isHead: boolean;
  lastOneOnOneAt: string | null;
  engagementScore: number | null;
  engagementScoreAt: string | null;
  hrSuggestions: PersonPulseHrSuggestion[] | null;
  hrSuggestionsGeneratedAt: string | null;
  moodTrend30d: PersonPulseMoodPoint[];
  checkInsTotal30d: number;
  checkInsExpectedDays: number;
  promisesReliabilityPercent: number;
  promisesDelta14d: number | null;
  promisesKept14d: number;
  promisesBroken14d: number;
  promisesOverdue14d: number;
}

/** ApiDto и Domain здесь совпадают — backend отдаёт plain JSON в этой же форме. */
export type PersonPulseApi = PersonPulse;
