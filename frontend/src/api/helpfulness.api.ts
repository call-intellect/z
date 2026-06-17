import { apiClient } from "./api-client";

export interface SocialContributionProfileApi {
  id: string;
  userId: string;
  helpProvidedCount: number;
  proactiveHintCount: number;
  mentoringCount: number;
  emotionalSupportCount: number;
  constructiveFeedbackCount: number;
  expertiseTopics: string[];
  socialRoles: string[];
  lastWeekHelpCount: number;
  lastMonthHelpCount: number;
  contributionScoreCached: number | null;
  buildVersion: number;
  lastBuiltAt: string;
}

export interface HelpfulnessTraitApi {
  id: string;
  traitType: string;
  intensity: number;
  topicHint: string | null;
  evidenceQuote: string | null;
  confidence: number;
  visibility: string;
  lastObservedAt: string;
  status: string;
}

export type SpotlightStatusApi =
  | "pending"
  | "approved"
  | "published"
  | "hidden";

export interface HelpfulnessSpotlightApi {
  id: string;
  helperUserId: string;
  helperName: string | null;
  topicHint: string | null;
  message: string;
  periodFrom: string;
  periodTo: string;
  helpCount: number;
  status: SpotlightStatusApi;
  approvedByUserId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface ListSpotlightsRequest {
  status?: SpotlightStatusApi;
  helperUserId?: string;
  page?: number;
  limit?: number;
}

export interface ListSpotlightsResponseApi {
  items: HelpfulnessSpotlightApi[];
  total: number;
  page: number;
  limit: number;
}

export interface TeamHelperRowApi {
  userId: string;
  name: string | null;
  helpProvidedCount: number;
  mentoringCount: number;
  proactiveHintCount: number;
  emotionalSupportCount: number;
  lastWeekHelpCount: number;
  topTopics: string[];
}

export interface UnansweredQuestionRowApi {
  id: string;
  recipientUserId: string | null;
  recipientName: string | null;
  helperUserId: string;
  helperName: string | null;
  topicHint: string | null;
  evidenceQuote: string | null;
  lastObservedAt: string;
}

export interface MyProfileResponseApi {
  profile: SocialContributionProfileApi | null;
  recentTraits: HelpfulnessTraitApi[];
}

export interface PersonProfileResponseApi {
  profile: SocialContributionProfileApi | null;
  publicTraits: HelpfulnessTraitApi[];
}

export interface SocialContributionOptOutApi {
  optedOut: boolean;
  updatedAt: string | null;
}

function buildSpotlightsQuery(req?: ListSpotlightsRequest): string {
  if (!req) return "";
  const p = new URLSearchParams();
  if (req.status) p.set("status", req.status);
  if (req.helperUserId) p.set("helperUserId", req.helperUserId);
  if (req.page) p.set("page", String(req.page));
  if (req.limit) p.set("limit", String(req.limit));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const helpfulnessApi = {
  getMySocialContribution: () =>
    apiClient.get<MyProfileResponseApi>("/api/v1/me/social-contribution"),

  getPersonSocialContribution: (personId: string) =>
    apiClient.get<PersonProfileResponseApi>(
      `/api/v1/persons/${encodeURIComponent(personId)}/social-contribution`,
    ),

  getMyOptOut: () =>
    apiClient.get<SocialContributionOptOutApi>(
      "/api/v1/me/social-contribution/opt-out",
    ),

  setMyOptOut: (optedOut: boolean) =>
    apiClient.post<SocialContributionOptOutApi>(
      "/api/v1/me/social-contribution/opt-out",
      { optedOut },
    ),

  getFeedSpotlights: (params?: ListSpotlightsRequest) =>
    apiClient.get<ListSpotlightsResponseApi>(
      `/api/v1/feed/spotlights${buildSpotlightsQuery(params)}`,
    ),

  approveSpotlight: (id: string) =>
    apiClient.post<{ ok: true; spotlight: HelpfulnessSpotlightApi }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/approve`,
    ),

  hideSpotlight: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/hide`,
    ),

  republishSpotlight: (id: string) =>
    apiClient.post<{ ok: true; spotlight: HelpfulnessSpotlightApi }>(
      `/api/v1/feed/spotlights/${encodeURIComponent(id)}/republish`,
    ),

  markTraitAsMisleading: (traitId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/me/social-contribution/traits/${encodeURIComponent(
        traitId,
      )}/mark-as-misleading`,
    ),

  getAdminTeamMap: () =>
    apiClient.get<TeamHelperRowApi[]>("/api/v1/admin/helpfulness/team-map"),

  getAdminUnanswered: () =>
    apiClient.get<UnansweredQuestionRowApi[]>(
      "/api/v1/admin/helpfulness/unanswered",
    ),
};
