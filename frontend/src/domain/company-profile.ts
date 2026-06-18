import type {
  CompanyProfileApi,
  CompanyStageApi,
  StrategyHorizonApi,
} from "@/api/company.api";

export const COMPANY_STAGE_LABEL: Record<CompanyStageApi, string> = {
  early_stage: "Ранняя стадия",
  growth: "Рост",
  scale: "Масштабирование",
  enterprise: "Зрелая компания",
};

export interface CompanyProfileDomain {
  id: string;
  tenantId: string;
  displayName: string | null;
  missionContentMd: string | null;
  missionHorizon: StrategyHorizonApi | null;
  visionContentMd: string | null;
  visionHorizonYears: number | null;
  strategyContentMd: string | null;
  strategyMarkets: string[];
  strategyBets: string[];
  stage: CompanyStageApi | null;
  stageLabel: string | null;
  maturityScore: number | null;
  maturityPercent: number | null;
  lastMaturityCalcAt: Date | null;
  updatedAt: Date;
}

export function toCompanyProfileDomain(
  api: CompanyProfileApi,
): CompanyProfileDomain {
  const stage = (api.stage as CompanyStageApi | null) ?? null;
  return {
    id: api.id,
    tenantId: api.tenantId,
    displayName: api.displayName,
    missionContentMd: api.mission?.contentMd ?? null,
    missionHorizon:
      (api.mission?.horizon as StrategyHorizonApi | undefined) ?? null,
    visionContentMd: api.vision?.contentMd ?? null,
    visionHorizonYears: api.vision?.horizonYears ?? null,
    strategyContentMd: api.strategy?.contentMd ?? null,
    strategyMarkets: api.strategy?.markets ?? [],
    strategyBets: api.strategy?.bets ?? [],
    stage,
    stageLabel: stage ? COMPANY_STAGE_LABEL[stage] : null,
    maturityScore: api.maturityScore,
    maturityPercent:
      api.maturityScore !== null
        ? Math.round(Math.max(0, Math.min(1, api.maturityScore)) * 100)
        : null,
    lastMaturityCalcAt: api.lastMaturityCalcAt
      ? new Date(api.lastMaturityCalcAt)
      : null,
    updatedAt: new Date(api.updatedAt),
  };
}
