export type PersonPulseSentiment = "green" | "yellow" | "red";

export type PersonPulseHrSuggestionType =
  | "praise"
  | "compensation_review"
  | "workload_check"
  | "development"
  | "urgent_talk";

export interface PersonPulseMoodPoint {
  date: string;
  sentiment: PersonPulseSentiment | null;
  qualityScore: number | null;
}

export interface PersonPulseHrSuggestion {
  type: PersonPulseHrSuggestionType;
  text: string;
  signals: string[];
  confidence: number;
}

export type PersonPulseRiskFlagSeverity = "low" | "medium" | "high";

export interface PersonPulseRiskFlag {
  type: string;
  severity: PersonPulseRiskFlagSeverity;
  baseline: number;
  current: number;
  explanation: string;
}

export interface PersonPulse {
  personId: string;
  personName: string;
  email: string;
  viewedUserId: string | null;
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
  riskFlags: PersonPulseRiskFlag[];
  riskFlagsGeneratedAt: string | null;
}

export type PersonPulseApi = PersonPulse;
