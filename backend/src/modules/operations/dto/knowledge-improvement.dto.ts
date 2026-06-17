export interface KnowledgeAtRiskItemDto {
  categoryName: string;
  soleExpertPersonId: string | null;
  soleExpertPersonName: string | null;
  busFactorLevel: string;
  personRiskLevel: string | null;
  combinedSeverity: string;
  snapshotAt: string;
}

export interface KnowledgeAtRiskListDto {
  items: KnowledgeAtRiskItemDto[];
}

export interface TeamCapacityItemDto {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: 'overload' | 'underload' | 'ok';
}

export interface TeamCapacityListDto {
  items: TeamCapacityItemDto[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

export interface OnboardingRampItemDto {
  personId: string;
  personName: string;
  userId: string | null;
  createdAt: string;
  firstActivityAt: string | null;
  daysSinceJoined: number;
  stalled: boolean;
}

export interface OnboardingRampListDto {
  items: OnboardingRampItemDto[];
  silentDays: number;
}
