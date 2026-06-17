import { apiClient } from "./api-client";

export interface KnowledgeGroupApi {
  id: string;
  kind: string;
  name: string;
  isClosed: boolean;
  refId: string | null;
  memberCount: number;
}

export interface ListGroupsResponseApi {
  items: KnowledgeGroupApi[];
}

export interface VisibilityPolicyApi {
  subjectGroupId: string;
  subjectGroupName: string;
  visibleGroupId: string;
  visibleGroupName: string;
}

export interface GetMatrixResponseApi {
  items: VisibilityPolicyApi[];
}

export interface SetMatrixRequestApi {
  visibleGroupIds: string[];
}

export interface SetMatrixResponseApi {
  ok: true;
  count: number;
}

export interface GroupMemberApi {
  personId: string;
  personName: string;
  source: string;
}

export interface ListMembersResponseApi {
  items: GroupMemberApi[];
}

export interface AddMemberRequestApi {
  personId: string;
}

export interface AddMemberResponseApi {
  ok: true;
  added: boolean;
}

export interface RemoveMemberResponseApi {
  ok: true;
  removed: boolean;
}

export interface SetClosedDefaultRequestApi {
  defaultClosedGroupKind: "leadership" | "council" | "personal" | null;
}

export interface SetClosedDefaultResponseApi {
  ok: true;
  typeId: string;
  defaultClosedGroupKind: "leadership" | "council" | "personal" | null;
}

export const knowledgeAccessApi = {
  listGroups: () =>
    apiClient.get<ListGroupsResponseApi>("/api/v1/knowledge-access/groups"),

  getMatrix: () =>
    apiClient.get<GetMatrixResponseApi>("/api/v1/knowledge-access/matrix"),

  setMatrix: (subjectGroupId: string, body: SetMatrixRequestApi) =>
    apiClient.put<SetMatrixResponseApi>(
      `/api/v1/knowledge-access/matrix/${encodeURIComponent(subjectGroupId)}`,
      body,
    ),

  listMembers: (groupId: string) =>
    apiClient.get<ListMembersResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members`,
    ),

  addMember: (groupId: string, body: AddMemberRequestApi) =>
    apiClient.post<AddMemberResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members`,
      body,
    ),

  removeMember: (groupId: string, personId: string) =>
    apiClient.del<RemoveMemberResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(personId)}`,
    ),

  setMeetingTypeClosedDefault: (
    typeId: string,
    body: SetClosedDefaultRequestApi,
  ) =>
    apiClient.patch<SetClosedDefaultResponseApi>(
      `/api/v1/knowledge-access/meeting-types/${encodeURIComponent(typeId)}/closed-default`,
      body,
    ),
};
