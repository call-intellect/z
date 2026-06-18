import { apiClient } from "./api-client";

export type ConsentDataType =
  | "checkin_processing"
  | "risk_analysis"
  | "card_visible_to_manager";

export interface ConsentRecordDto {
  id: string;
  dataType: string;
  consented: boolean;
  policyVersion: string;
  createdAt: string;
}

export interface AccessLogItemDto {
  accessedAt: string;
  viewerUserName: string | null;
  viewerUserEmail: string | null;
  sectionAccessed: string;
}

export const privacyApi = {
  listMyConsents: (orgId: string) =>
    apiClient.get<{ items: ConsentRecordDto[] }>("/api/v1/me/consents", {
      headers: { "X-Org-Id": orgId },
    }),

  upsertMyConsent: (
    orgId: string,
    body: {
      dataType: ConsentDataType;
      consented: boolean;
      policyVersion?: string;
    },
  ) =>
    apiClient.post<{ ok: true }>("/api/v1/me/consents", body, {
      headers: { "X-Org-Id": orgId },
    }),

  getMyAccessLog: (orgId: string, params: { limit?: number } = {}) => {
    const usp = new URLSearchParams();
    if (params.limit) usp.set("limit", String(params.limit));
    const qs = usp.toString();
    return apiClient.get<{ items: AccessLogItemDto[] }>(
      `/api/v1/me/privacy/access-log${qs ? `?${qs}` : ""}`,
      { headers: { "X-Org-Id": orgId } },
    );
  },
};
