import { apiClient } from "./api-client";

export interface OrgMemberUserApi {
  type: "user";
  userId: string;
  name: string;
  email: string;
  primaryRole: string | null;
  avatarUrl: string | null;
}

export interface OrgMemberPersonApi {
  type: "person";
  personId: string;
  name: string;
  email: string | null;
  relationship: "employee" | "external" | string;
  primaryDepartment: string | null;
}

export type OrgMemberSearchItemApi = OrgMemberUserApi | OrgMemberPersonApi;

export interface OrgMembersSearchResponseApi {
  items: OrgMemberSearchItemApi[];
}

export const orgMembersApi = {
  search: (q: string, limit = 10) => {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("limit", String(limit));
    return apiClient.get<OrgMembersSearchResponseApi>(
      `/api/v1/org-members/search?${params.toString()}`,
    );
  },
};
