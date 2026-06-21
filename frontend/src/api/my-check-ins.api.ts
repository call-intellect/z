import { apiClient } from "./api-client";

export interface CheckInPlanItemApi {
  text: string;
  sourceBlockId?: string;
  priority?: number;
}

export interface CheckInDoneItemApi {
  text: string;
  sourceBlockId?: string;
  evidenceLink?: string;
}

export interface CheckInBlockerItemApi {
  text: string;
  severity?: "low" | "medium" | "high";
  ownerHint?: string;
}

export interface DailyCheckInApi {
  id: string;
  tenantId: string;
  personId: string;
  kind: "morning" | "evening";
  dateLocal: string;
  source:
    | "cron_prompted"
    | "self_initiated"
    | "manual"
    | "meeting"
    | "bitrix"
    | "chatbox"
    | "email"
    | "phone_call";
  plans: CheckInPlanItemApi[];
  dones: CheckInDoneItemApi[];
  blockers: CheckInBlockerItemApi[];
  notificationId: string | null;
  parseConfidence: number | null;
  curatorReview: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCheckInBody {
  kind: "morning" | "evening";
  dateLocal?: string;
  plans?: CheckInPlanItemApi[];
  dones?: CheckInDoneItemApi[];
  blockers?: CheckInBlockerItemApi[];
  rawText?: string;
}

export const myCheckInsApi = {
  list: (params?: { date?: string; kind?: "morning" | "evening" }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set("date", params.date);
    if (params?.kind) q.set("kind", params.kind);
    const suffix = q.toString();
    return apiClient.get<{ items: DailyCheckInApi[] }>(
      `/api/v1/me/check-ins${suffix ? `?${suffix}` : ""}`,
    );
  },
  create: (body: CreateCheckInBody) =>
    apiClient.post<DailyCheckInApi>("/api/v1/me/check-ins", body),
  history: (days = 30) =>
    apiClient.get<{ items: DailyCheckInApi[] }>(
      `/api/v1/me/check-ins/history?days=${days}`,
    ),
};
