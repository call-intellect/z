export type PeopleAtRiskItemApi = {
  personId: string;
  name: string;
  department: string | null;
  pulseScore: number;
  topReason: string;
  engagementScoreAt: string | null;
};

export type PeopleAtRiskResponseApi = {
  items: PeopleAtRiskItemApi[];
  totalAtRisk: number;
  generatedAt: string;
};

export type PeopleAtRiskItemDomain = PeopleAtRiskItemApi;
export type PeopleAtRiskResponseDomain = PeopleAtRiskResponseApi;

export function peopleAtRiskFromApi(
  api: PeopleAtRiskResponseApi,
): PeopleAtRiskResponseDomain {
  return {
    items: api.items.map((it) => ({
      personId: it.personId,
      name: it.name,
      department: it.department,
      pulseScore: it.pulseScore,
      topReason: it.topReason,
      engagementScoreAt: it.engagementScoreAt,
    })),
    totalAtRisk: api.totalAtRisk,
    generatedAt: api.generatedAt,
  };
}
