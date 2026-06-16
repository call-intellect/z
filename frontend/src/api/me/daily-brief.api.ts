import { apiClient } from "../api-client";

export interface BriefItemApi {
  kind: string;
  title: string;
  dueDateIso: string | null;
  overdue: boolean;
  counterpartyName: string | null;
}

export interface BriefKnowsWhoApi {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

export interface BriefInsightCoOccurrenceApi {
  statement: string;
  colleaguesCount: number;
  escalated: boolean;
}

export interface DailyBriefApi {
  id: string | null;
  dateLocal: string;
  myTasks: BriefItemApi[];
  myPromises: BriefItemApi[];
  myBlockers: BriefItemApi[];
  promisedToMe: BriefItemApi[];
  hint: string;
  knowsWho: BriefKnowsWhoApi | null;
  insightCoOccurrence?: BriefInsightCoOccurrenceApi | null;
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
  deliveredAt: string | null;
  openedAt: string | null;
}

export const meDailyBriefApi = {
  get: (date?: string) =>
    apiClient.get<DailyBriefApi>(
      date
        ? `/api/v1/me/daily-brief?date=${encodeURIComponent(date)}`
        : "/api/v1/me/daily-brief",
    ),

  markOpened: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/me/daily-brief/${encodeURIComponent(id)}/opened`,
    ),
};
