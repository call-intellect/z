import type {
  HelpfulnessSpotlightApi,
  HelpfulnessTraitApi,
  ListSpotlightsResponseApi,
  MyProfileResponseApi,
  PersonProfileResponseApi,
  SocialContributionProfileApi,
  SpotlightStatusApi,
  TeamHelperRowApi,
  UnansweredQuestionRowApi,
} from "@/api/helpfulness.api";

export type HelpfulnessTraitType =
  | "help_provided"
  | "proactive_hint"
  | "mentoring"
  | "emotional_support"
  | "constructive_feedback"
  | "question_unanswered"
  | "question_acknowledged_no_action";

export const PUBLIC_TRAIT_TYPES = [
  "help_provided",
  "proactive_hint",
  "mentoring",
  "emotional_support",
  "constructive_feedback",
] as const;

export type PublicHelpfulnessTraitType = (typeof PUBLIC_TRAIT_TYPES)[number];

export function isPublicTraitType(t: string): t is PublicHelpfulnessTraitType {
  return (PUBLIC_TRAIT_TYPES as readonly string[]).includes(t);
}

export const HELPFULNESS_TRAIT_LABEL: Record<
  PublicHelpfulnessTraitType,
  string
> = {
  help_provided: "Помог по вопросу",
  proactive_hint: "Проактивная подсказка",
  mentoring: "Менторство",
  emotional_support: "Эмоциональная поддержка",
  constructive_feedback: "Конструктивная обратная связь",
};

export const HELPFULNESS_TRAIT_SHORT: Record<
  PublicHelpfulnessTraitType,
  string
> = {
  help_provided: "Ответы на вопросы",
  proactive_hint: "Подсказки",
  mentoring: "Менторство",
  emotional_support: "Поддержка",
  constructive_feedback: "Фидбек",
};

export const HELPFULNESS_TRAIT_DESCRIPTION: Record<
  PublicHelpfulnessTraitType,
  string
> = {
  help_provided: "Развёрнутый ответ на конкретный вопрос коллеги.",
  proactive_hint:
    "Подсказка без запроса — «кстати, у нас есть инструкция по X».",
  mentoring: "Обучающее объяснение — не просто «делай Y», а «потому что Z».",
  emotional_support:
    "«Не переживай», «давай разберёмся вместе» — поддержка в сложный момент.",
  constructive_feedback:
    "Критика с предложением решения, а не просто указание на проблему.",
};

export type SpotlightStatus = SpotlightStatusApi;

export const SPOTLIGHT_STATUS_LABEL: Record<SpotlightStatus, string> = {
  pending: "Ждёт одобрения",
  approved: "Одобрено",
  published: "Опубликовано",
  hidden: "Скрыто",
};

export const SPOTLIGHT_STATUS_TONE: Record<
  SpotlightStatus,
  "neutral" | "info" | "success" | "warning"
> = {
  pending: "warning",
  approved: "info",
  published: "success",
  hidden: "neutral",
};

export interface HelpfulnessTrait {
  id: string;
  traitType: string;
  publicType: PublicHelpfulnessTraitType | null;
  intensity: number;
  topicHint: string | null;
  evidenceQuote: string | null;
  confidence: number;
  visibility: string;
  status: string;
  lastObservedAt: Date;
  source: string;
  createdAt: Date;
}

export interface SocialContributionProfile {
  id: string;
  userId: string;
  counts: {
    help_provided: number;
    proactive_hint: number;
    mentoring: number;
    emotional_support: number;
    constructive_feedback: number;
  };
  expertiseTopics: string[];
  socialRoles: string[];
  lastWeekHelpCount: number;
  lastMonthHelpCount: number;
  contributionScoreCached: number | null;
  buildVersion: number;
  lastBuiltAt: Date;
}

export interface HelpfulnessSpotlight {
  id: string;
  helperUserId: string;
  helperName: string | null;
  topicHint: string | null;
  message: string;
  period: { from: Date; to: Date };
  helpCount: number;
  status: SpotlightStatus;
  approvedByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface MyContributionView {
  profile: SocialContributionProfile | null;
  recentTraits: HelpfulnessTrait[];
}

export interface PersonContributionView {
  profile: SocialContributionProfile | null;
  publicTraits: HelpfulnessTrait[];
}

export interface ListSpotlightsResult {
  items: HelpfulnessSpotlight[];
  total: number;
  page: number;
  limit: number;
}

export interface TeamHelperRow {
  userId: string;
  name: string | null;
  helpProvidedCount: number;
  mentoringCount: number;
  proactiveHintCount: number;
  emotionalSupportCount: number;
  lastWeekHelpCount: number;
  topTopics: string[];
  totalPublicCount: number;
}

export interface UnansweredQuestionRow {
  id: string;
  recipientUserId: string | null;
  recipientName: string | null;
  helperUserId: string;
  helperName: string | null;
  topicHint: string | null;
  evidenceQuote: string | null;
  lastObservedAt: Date;
}

export function mapHelpfulnessTrait(
  dto: HelpfulnessTraitApi,
): HelpfulnessTrait {
  const publicType = isPublicTraitType(dto.traitType) ? dto.traitType : null;
  return {
    id: dto.id,
    traitType: dto.traitType,
    publicType,
    intensity: dto.intensity,
    topicHint: dto.topicHint,
    evidenceQuote: dto.evidenceQuote,
    confidence: dto.confidence,
    visibility: dto.visibility,
    status: dto.status,
    lastObservedAt: new Date(dto.lastObservedAt),
    source: dto.visibility,
    createdAt: new Date(dto.lastObservedAt),
  };
}

export function mapSocialContributionProfile(
  dto: SocialContributionProfileApi,
): SocialContributionProfile {
  return {
    id: dto.id,
    userId: dto.userId,
    counts: {
      help_provided: dto.helpProvidedCount,
      proactive_hint: dto.proactiveHintCount,
      mentoring: dto.mentoringCount,
      emotional_support: dto.emotionalSupportCount,
      constructive_feedback: dto.constructiveFeedbackCount,
    },
    expertiseTopics: dto.expertiseTopics,
    socialRoles: dto.socialRoles,
    lastWeekHelpCount: dto.lastWeekHelpCount,
    lastMonthHelpCount: dto.lastMonthHelpCount,
    contributionScoreCached: dto.contributionScoreCached,
    buildVersion: dto.buildVersion,
    lastBuiltAt: new Date(dto.lastBuiltAt),
  };
}

export function mapHelpfulnessSpotlight(
  dto: HelpfulnessSpotlightApi,
): HelpfulnessSpotlight {
  return {
    id: dto.id,
    helperUserId: dto.helperUserId,
    helperName: dto.helperName,
    topicHint: dto.topicHint,
    message: dto.message,
    period: { from: new Date(dto.periodFrom), to: new Date(dto.periodTo) },
    helpCount: dto.helpCount,
    status: dto.status,
    approvedByUserId: dto.approvedByUserId,
    publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
    createdAt: new Date(dto.createdAt),
  };
}

export function mapMyProfile(dto: MyProfileResponseApi): MyContributionView {
  return {
    profile: dto.profile ? mapSocialContributionProfile(dto.profile) : null,
    recentTraits: dto.recentTraits
      .filter((t) => isPublicTraitType(t.traitType))
      .map(mapHelpfulnessTrait),
  };
}

export function mapPersonProfile(
  dto: PersonProfileResponseApi,
): PersonContributionView {
  return {
    profile: dto.profile ? mapSocialContributionProfile(dto.profile) : null,
    publicTraits: dto.publicTraits
      .filter((t) => isPublicTraitType(t.traitType))
      .map(mapHelpfulnessTrait),
  };
}

export function mapListSpotlights(
  dto: ListSpotlightsResponseApi,
): ListSpotlightsResult {
  return {
    items: dto.items.map(mapHelpfulnessSpotlight),
    total: dto.total,
    page: dto.page,
    limit: dto.limit,
  };
}

export function mapTeamHelperRow(dto: TeamHelperRowApi): TeamHelperRow {
  const totalPublicCount =
    dto.helpProvidedCount +
    dto.mentoringCount +
    dto.proactiveHintCount +
    dto.emotionalSupportCount;
  return {
    userId: dto.userId,
    name: dto.name,
    helpProvidedCount: dto.helpProvidedCount,
    mentoringCount: dto.mentoringCount,
    proactiveHintCount: dto.proactiveHintCount,
    emotionalSupportCount: dto.emotionalSupportCount,
    lastWeekHelpCount: dto.lastWeekHelpCount,
    topTopics: dto.topTopics,
    totalPublicCount,
  };
}

export function mapTeamMap(rows: TeamHelperRowApi[]): TeamHelperRow[] {
  return rows.map(mapTeamHelperRow);
}

export function mapUnansweredRow(
  dto: UnansweredQuestionRowApi,
): UnansweredQuestionRow {
  return {
    id: dto.id,
    recipientUserId: dto.recipientUserId,
    recipientName: dto.recipientName,
    helperUserId: dto.helperUserId,
    helperName: dto.helperName,
    topicHint: dto.topicHint,
    evidenceQuote: dto.evidenceQuote,
    lastObservedAt: new Date(dto.lastObservedAt),
  };
}

export function mapUnanswered(
  rows: UnansweredQuestionRowApi[],
): UnansweredQuestionRow[] {
  return rows.map(mapUnansweredRow);
}

export function totalPublicCount(p: SocialContributionProfile): number {
  return (
    p.counts.help_provided +
    p.counts.proactive_hint +
    p.counts.mentoring +
    p.counts.emotional_support +
    p.counts.constructive_feedback
  );
}

export const SOCIAL_ROLE_LABEL: Record<string, string> = {
  mentor: "Ментор",
  connector: "Соединитель",
  problem_solver: "Решатель проблем",
  mood_keeper: "Хранитель настроения",
  trainer: "Обучатель новеньких",
};

export function socialRoleLabel(role: string): string {
  return SOCIAL_ROLE_LABEL[role] ?? role;
}
