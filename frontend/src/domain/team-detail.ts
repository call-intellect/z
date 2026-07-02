export type TeamMemberSentimentApi = "green" | "yellow" | "red" | null;

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
  sentimentTrend: "up" | "flat" | "down";
  goals: TeamDetailGoalApi[];
  topThemes: TeamDetailThemeApi[];
};

export type TeamDetailMemberDomain = TeamDetailMemberApi;
export type TeamDetailThemeDomain = TeamDetailThemeApi;
export type TeamDetailDomain = TeamDetailApi;

export function teamDetailFromApi(api: TeamDetailApi): TeamDetailDomain {
  return api;
}
