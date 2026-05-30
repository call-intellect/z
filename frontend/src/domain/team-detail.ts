/**
 * Доменные типы для детальной страницы команды (Pulse Wave 2 §2.5).
 *
 * Источник правды:
 *   `backend/src/modules/dashboard/services/team-detail.service.ts`
 *   `GET /api/v1/dashboard/teams/:id` → `TeamDetailApi`.
 *
 * Mapping ApiDto → DomainModel здесь тождественный (поля простые,
 * сериализация не нужна). Если в будущем появится `Date` или
 * нормализация — менять мапперы здесь, без правки UI.
 */

export type TeamMemberSentimentApi = 'green' | 'yellow' | 'red' | null;

export type TeamDetailMemberApi = {
  personId: string;
  personName: string;
  email: string;
  isHead: boolean;
  sentiment: TeamMemberSentimentApi;
  sentimentCheckInsCount: number;
};

export type TeamDetailGoalApi = {
  goalId: string;
  name: string;
  status: string;
  ownerPersonId: string | null;
  ownerPersonName: string | null;
};

export type TeamDetailThemeApi = {
  themeId: string;
  themeName: string;
  blocksCount: number;
};

export type TeamDetailApi = {
  departmentId: string;
  departmentName: string;
  missionStatement: string | null;
  headPersonId: string | null;
  headPersonName: string | null;
  totalMembers: number;
  members: TeamDetailMemberApi[];
  sentimentIndex: number;
  sentimentTrend: 'up' | 'flat' | 'down';
  commitmentReliabilityPercent: number;
  commitmentDelta14d: number | null;
  goals: TeamDetailGoalApi[];
  topThemes: TeamDetailThemeApi[];
};

// Domain — alias (типы простые, без нормализации).
export type TeamDetailMemberDomain = TeamDetailMemberApi;
export type TeamDetailGoalDomain = TeamDetailGoalApi;
export type TeamDetailThemeDomain = TeamDetailThemeApi;
export type TeamDetailDomain = TeamDetailApi;

export function teamDetailFromApi(api: TeamDetailApi): TeamDetailDomain {
  return api;
}
