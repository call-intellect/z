import type { ChatV2UsageStatsApi } from "@/api/chat-v2.api";

export interface ChatUsageStatsDomain {
  from: string;
  to: string;
  scope: "self" | "org";
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  helpedRatePercent: number | null;
  feedbackCoveragePercent: number;
  groundedRatePercent: number;
  helpedRateHidden: boolean;
  minRated: number;
}

export function chatUsageStatsFromApi(
  api: ChatV2UsageStatsApi,
): ChatUsageStatsDomain {
  return {
    from: api.from,
    to: api.to,
    scope: api.scope,
    asked: api.asked,
    answered: api.answered,
    answeredWithCitation: api.answeredWithCitation,
    rated: api.rated,
    helpedUp: api.helpedUp,
    helpedRatePercent: api.helpedRatePercent,
    feedbackCoveragePercent: api.feedbackCoveragePercent,
    groundedRatePercent: api.groundedRatePercent,
    helpedRateHidden: api.helpedRateHidden,
    minRated: api.minRated,
  };
}
