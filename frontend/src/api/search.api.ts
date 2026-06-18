import { apiClient } from "./api-client";

export type SearchTypeKey =
  | "cards"
  | "meetings"
  | "tasks"
  | "roles"
  | "departments"
  | "persons"
  | "documents"
  | "role-profiles";

export type SearchCardItem = {
  id: string;
  name: string;
  kind: string;
  lastMeetingAt: string | null;
  meetingCount: number;
};

export type SearchMeetingItem = {
  id: string;
  title: string;
  type: string;
  cardId: string | null;
  createdAt: string;
};

export type SearchTaskItem = {
  id: string;
  title: string;
  status: string;
  meetingId: string;
};

export type SearchRoleItem = {
  id: string;
  name: string;
  departmentName?: string | null;
};

export type SearchDepartmentItem = {
  id: string;
  name: string;
};

export type SearchPersonItem = {
  id: string;
  fullName: string;
  roleName?: string | null;
};

export type SearchDocumentItem = {
  id: string;
  name: string;
  kind?: string;
};

export type SearchRoleProfileItem = {
  roleId: string;
  roleName: string;
};

export type SearchResponse = {
  cards: SearchCardItem[];
  meetings: SearchMeetingItem[];
  tasks: SearchTaskItem[];
  roles?: SearchRoleItem[];
  departments?: SearchDepartmentItem[];
  persons?: SearchPersonItem[];
  documents?: SearchDocumentItem[];
  roleProfiles?: SearchRoleProfileItem[];
};

export const searchApi = {
  query: (q: string, types?: SearchTypeKey[], limit = 10) => {
    const params = new URLSearchParams();
    params.set("q", q);
    if (types && types.length > 0) params.set("types", types.join(","));
    params.set("limit", String(limit));
    return apiClient.get<SearchResponse>(`/api/v1/search?${params.toString()}`);
  },
};
