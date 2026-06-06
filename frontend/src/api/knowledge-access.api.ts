/**
 * API-клиент `knowledge-access` — управление доступом к знаниям через группы
 * (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть B — frontend).
 *
 * Контракт сервера: `backend/src/modules/knowledge-access/
 * knowledge-access-admin.controller.ts` (префикс `/api/v1/knowledge-access`).
 *
 * RBAC: только owner / admin Org (через `OrgAdminGuard` на бэке). Все запросы
 * tenant-scoped — `X-Org-Id` добавляется api-client'ом по умолчанию из
 * auth-context (текущая Org).
 *
 * Имена полей в DTO — ТОЧНО как у backend (ответы обёрнуты в `{ items: [...] }`).
 */

import { apiClient } from './api-client';

// ─── Группы доступа ──────────────────────────────────────────────────────────

/** Вид группы доступа: отдел / руководство / совет / личный сейф. */
export type KnowledgeGroupKindApi =
  | 'department'
  | 'leadership'
  | 'council'
  | 'personal';

/** Закрытая группа (для встреч): null = открыто. */
export type ClosedGroupKindApi = 'leadership' | 'council' | 'personal' | null;

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

// ─── Матрица видимости (направленная) ──────────────────────────────────────────

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

// ─── Членство в группе ─────────────────────────────────────────────────────────

export interface GroupMemberApi {
  personId: string;
  personName: string;
  /** 'auto' (из должности) | 'manual' (ручной override). */
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

// ─── Дефолт закрытости по типу встречи (крутилка) ───────────────────────────────

export interface SetClosedDefaultRequestApi {
  /** null = открыто; 'leadership' | 'council' | 'personal'. */
  defaultClosedGroupKind: 'leadership' | 'council' | 'personal' | null;
}

export interface SetClosedDefaultResponseApi {
  ok: true;
  typeId: string;
  defaultClosedGroupKind: 'leadership' | 'council' | 'personal' | null;
}

// ─── API surface ────────────────────────────────────────────────────────────────

export const knowledgeAccessApi = {
  /** Список групп доступа компании (с числом участников). */
  listGroups: () =>
    apiClient.get<ListGroupsResponseApi>('/api/v1/knowledge-access/groups'),

  /** Матрица видимости отделов (направленная). */
  getMatrix: () =>
    apiClient.get<GetMatrixResponseApi>('/api/v1/knowledge-access/matrix'),

  /** Задать направленно список видимых отделов для отдела-субъекта. */
  setMatrix: (subjectGroupId: string, body: SetMatrixRequestApi) =>
    apiClient.put<SetMatrixResponseApi>(
      `/api/v1/knowledge-access/matrix/${encodeURIComponent(subjectGroupId)}`,
      body,
    ),

  /** Список членов группы. */
  listMembers: (groupId: string) =>
    apiClient.get<ListMembersResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members`,
    ),

  /** Добавить человека в группу (override / поднять в руководство без должности). */
  addMember: (groupId: string, body: AddMemberRequestApi) =>
    apiClient.post<AddMemberResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members`,
      body,
    ),

  /** Убрать человека из группы. */
  removeMember: (groupId: string, personId: string) =>
    apiClient.del<RemoveMemberResponseApi>(
      `/api/v1/knowledge-access/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(personId)}`,
    ),

  /** Дефолт закрытости встреч по типу (крутилка по `MeetingTypeConfig.id`). */
  setMeetingTypeClosedDefault: (typeId: string, body: SetClosedDefaultRequestApi) =>
    apiClient.patch<SetClosedDefaultResponseApi>(
      `/api/v1/knowledge-access/meeting-types/${encodeURIComponent(typeId)}/closed-default`,
      body,
    ),
};
