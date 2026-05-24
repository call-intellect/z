/**
 * T1 (2026-05-23) — Gamification & Recognition API client.
 *
 * Покрывает endpoint'ы модуля `recognition`:
 *   GET  /api/v1/me/contributions                          — мой профиль вклада
 *   GET  /api/v1/persons/:id/contributions                 — профиль сотрудника
 *   GET  /api/v1/orgs/:orgId/recognition/team-spotlight    — недельный спотлайт
 *   POST /api/v1/me/recognition-optout                     — opt-out видимости
 *   GET  /api/v1/me/recognition-optout                     — текущая видимость
 *
 * Слой ApiDto зеркалит backend (`recognition.dto.ts`). Маппинг в DomainModel —
 * в `frontend/src/domain/contribution.ts`.
 */

import { apiClient } from './api-client';

// ─────────────────────────── ApiDto (зеркало backend) ─────────────────────

export type RecognitionTypeApi =
  | 'thanks_comment'
  | 'thanks_helpfulness'
  | 'mention_helped'
  | 'idea_shipped'
  | 'streak_milestone'
  | 'weekly_summary';

export type RecognitionVisibilityApi = 'private' | 'team' | 'public_org';

export interface RecognitionApiDto {
  id: string;
  tenantId: string;
  fromUserId: string | null;
  toUserId: string;
  type: RecognitionTypeApi;
  contextEntityType: string | null;
  contextEntityId: string | null;
  message: string | null;
  visibility: RecognitionVisibilityApi;
  createdAt: string;
}

export interface ContributionsSnapshotApiDto {
  userId: string;
  ideasInDevelopment: number;
  ideasShipped: number;
  thanksReceived: number;
  thanksReceivedWeek: number;
  currentCheckinStreak: number;
  longestCheckinStreak: number;
  helpfulComments: number;
  probeQuestionsAnswered: number;
  updatedAt: string | null;
}

export interface UserBadgeApiDto {
  id: string;
  badgeId: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  awardedAt: string;
}

export interface MyContributionsApiDto {
  snapshot: ContributionsSnapshotApiDto;
  badges: UserBadgeApiDto[];
  recentRecognitions: RecognitionApiDto[];
}

export type PersonContributionsApiDto = MyContributionsApiDto;

export interface TeamSpotlightPersonApiDto {
  personId: string | null;
  userId: string;
  name: string;
  avatar: string | null;
  highlightReason: string;
  recognitionCount: number;
  thanksReceived: number;
}

export interface TeamSpotlightApiDto {
  period: { from: string; to: string };
  persons: TeamSpotlightPersonApiDto[];
}

export interface RecognitionOptOutApiDto {
  publicVisible: boolean;
  updatedAt: string;
}

// ─────────────────────────── API calls ──────────────────────────────────────

export const gamificationApi = {
  /**
   * Мой профиль вклада: snapshot + бейджи + последние 10 Recognition.
   * Backend сам резолвит userId по cookie-session.
   */
  getMyContributions: (): Promise<MyContributionsApiDto> =>
    apiClient.get<MyContributionsApiDto>('/api/v1/me/contributions'),

  /**
   * Профиль вклада сотрудника (для руководителя). 403 если нет manage по org.
   */
  getPersonContributions: (personId: string): Promise<PersonContributionsApiDto> =>
    apiClient.get<PersonContributionsApiDto>(
      `/api/v1/persons/${encodeURIComponent(personId)}/contributions`,
    ),

  /**
   * Недельный спотлайт команды — top 3-5 человек по Recognition.
   * orgId передаётся и в URL, и в X-Org-Id (для TenantGuard).
   */
  getTeamSpotlight: (orgId: string): Promise<TeamSpotlightApiDto> =>
    apiClient.get<TeamSpotlightApiDto>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/recognition/team-spotlight`,
      { headers: { 'X-Org-Id': orgId } },
    ),

  /**
   * Установить видимость своих Recognition для команды.
   * `publicVisible=false` — скрыть себя из TeamSpotlight и дашбордов коллег.
   */
  setRecognitionOptOut: (publicVisible: boolean): Promise<RecognitionOptOutApiDto> =>
    apiClient.post<RecognitionOptOutApiDto>(
      '/api/v1/me/recognition-optout',
      { publicVisible },
    ),

  /** Текущая настройка видимости. */
  getRecognitionOptOut: (): Promise<RecognitionOptOutApiDto> =>
    apiClient.get<RecognitionOptOutApiDto>('/api/v1/me/recognition-optout'),
};
