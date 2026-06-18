import { apiClient } from "./api-client";

export type RecognitionTypeApi =
  | "thanks_comment"
  | "thanks_helpfulness"
  | "mention_helped"
  | "idea_shipped"
  | "streak_milestone"
  | "weekly_summary";

export type RecognitionVisibilityApi = "private" | "team" | "public_org";

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

export const gamificationApi = {
  getMyContributions: (): Promise<MyContributionsApiDto> =>
    apiClient.get<MyContributionsApiDto>("/api/v1/me/contributions"),

  getPersonContributions: (
    personId: string,
  ): Promise<PersonContributionsApiDto> =>
    apiClient.get<PersonContributionsApiDto>(
      `/api/v1/persons/${encodeURIComponent(personId)}/contributions`,
    ),

  getTeamSpotlight: (orgId: string): Promise<TeamSpotlightApiDto> =>
    apiClient.get<TeamSpotlightApiDto>(
      `/api/v1/orgs/${encodeURIComponent(orgId)}/recognition/team-spotlight`,
      { headers: { "X-Org-Id": orgId } },
    ),

  setRecognitionOptOut: (
    publicVisible: boolean,
  ): Promise<RecognitionOptOutApiDto> =>
    apiClient.post<RecognitionOptOutApiDto>("/api/v1/me/recognition-optout", {
      publicVisible,
    }),

  getRecognitionOptOut: (): Promise<RecognitionOptOutApiDto> =>
    apiClient.get<RecognitionOptOutApiDto>("/api/v1/me/recognition-optout"),
};
