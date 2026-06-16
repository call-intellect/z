import type {
  ContributionsSnapshotApiDto,
  MyContributionsApiDto,
  PersonContributionsApiDto,
  RecognitionApiDto,
  RecognitionTypeApi,
  RecognitionVisibilityApi,
  TeamSpotlightApiDto,
  TeamSpotlightPersonApiDto,
  UserBadgeApiDto,
} from "@/api/gamification.api";

export type RecognitionType = RecognitionTypeApi;
export type RecognitionVisibility = RecognitionVisibilityApi;

export const RECOGNITION_TYPE_LABELS: Record<RecognitionType, string> = {
  thanks_comment: "Спасибо за комментарий",
  thanks_helpfulness: "Спасибо за полезность",
  mention_helped: "Помог коллеге",
  idea_shipped: "Идея в работе",
  streak_milestone: "Стрик чек-инов",
  weekly_summary: "Недельная благодарность",
};

const KNOWN_RECOGNITION_TYPES: ReadonlySet<string> = new Set([
  "thanks_comment",
  "thanks_helpfulness",
  "mention_helped",
  "idea_shipped",
  "streak_milestone",
  "weekly_summary",
]);

function parseRecognitionType(raw: string): RecognitionType {
  return (
    KNOWN_RECOGNITION_TYPES.has(raw) ? raw : "weekly_summary"
  ) as RecognitionType;
}

export interface RecognitionEntry {
  id: string;
  fromUserId: string | null;
  toUserId: string;
  type: RecognitionType;
  typeLabel: string;
  contextEntityType: string | null;
  contextEntityId: string | null;
  message: string | null;
  visibility: RecognitionVisibility;
  createdAt: Date;
}

export interface CheckinStreakInfo {
  current: number;
  longest: number;
}

export interface IdeaInProgress {
  inDevelopment: number;
  shipped: number;
}

export interface ContributionSnapshot {
  userId: string;
  ideas: IdeaInProgress;
  thanksReceivedTotal: number;
  thanksReceivedThisWeek: number;
  helpfulComments: number;
  probeQuestionsAnswered: number;
  checkinStreak: CheckinStreakInfo;
  updatedAt: Date | null;
}

export interface UserBadgeDomain {
  id: string;
  badgeId: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  awardedAt: Date;
}

export interface Contribution {
  snapshot: ContributionSnapshot;
  badges: UserBadgeDomain[];
  recentRecognitions: RecognitionEntry[];
}

export interface TeamSpotlightPerson {
  personId: string | null;
  userId: string;
  name: string;
  avatar: string | null;
  highlightReason: string;
  recognitionCount: number;
  thanksReceived: number;
}

export interface TeamSpotlight {
  from: Date;
  to: Date;
  persons: TeamSpotlightPerson[];
}

export function recognitionEntryFromApi(
  dto: RecognitionApiDto,
): RecognitionEntry {
  const type = parseRecognitionType(dto.type);
  return {
    id: dto.id,
    fromUserId: dto.fromUserId,
    toUserId: dto.toUserId,
    type,
    typeLabel: RECOGNITION_TYPE_LABELS[type],
    contextEntityType: dto.contextEntityType,
    contextEntityId: dto.contextEntityId,
    message: dto.message,
    visibility: dto.visibility,
    createdAt: new Date(dto.createdAt),
  };
}

export function userBadgeFromApi(dto: UserBadgeApiDto): UserBadgeDomain {
  return {
    id: dto.id,
    badgeId: dto.badgeId,
    slug: dto.slug,
    name: dto.name,
    description: dto.description,
    iconUrl: dto.iconUrl,
    awardedAt: new Date(dto.awardedAt),
  };
}

export function contributionSnapshotFromApi(
  dto: ContributionsSnapshotApiDto,
): ContributionSnapshot {
  return {
    userId: dto.userId,
    ideas: {
      inDevelopment: dto.ideasInDevelopment,
      shipped: dto.ideasShipped,
    },
    thanksReceivedTotal: dto.thanksReceived,
    thanksReceivedThisWeek: dto.thanksReceivedWeek,
    helpfulComments: dto.helpfulComments,
    probeQuestionsAnswered: dto.probeQuestionsAnswered,
    checkinStreak: {
      current: dto.currentCheckinStreak,
      longest: dto.longestCheckinStreak,
    },
    updatedAt: dto.updatedAt ? new Date(dto.updatedAt) : null,
  };
}

export function contributionFromApi(
  dto: MyContributionsApiDto | PersonContributionsApiDto,
): Contribution {
  return {
    snapshot: contributionSnapshotFromApi(dto.snapshot),
    badges: dto.badges.map(userBadgeFromApi),
    recentRecognitions: dto.recentRecognitions.map(recognitionEntryFromApi),
  };
}

export function teamSpotlightPersonFromApi(
  dto: TeamSpotlightPersonApiDto,
): TeamSpotlightPerson {
  return {
    personId: dto.personId,
    userId: dto.userId,
    name: dto.name,
    avatar: dto.avatar,
    highlightReason: dto.highlightReason,
    recognitionCount: dto.recognitionCount,
    thanksReceived: dto.thanksReceived,
  };
}

export function teamSpotlightFromApi(dto: TeamSpotlightApiDto): TeamSpotlight {
  return {
    from: new Date(dto.period.from),
    to: new Date(dto.period.to),
    persons: dto.persons.map(teamSpotlightPersonFromApi),
  };
}

export function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const abs = Math.abs(n) % 100;
  const lastOne = abs % 10;
  if (abs >= 11 && abs <= 14) return `${n} ${many}`;
  if (lastOne === 1) return `${n} ${one}`;
  if (lastOne >= 2 && lastOne <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function thanksLabel(n: number): string {
  return pluralRu(n, "благодарность", "благодарности", "благодарностей");
}

export function ideasInDevLabel(n: number): string {
  return pluralRu(n, "идея в работе", "идеи в работе", "идей в работе");
}

export function streakLabel(n: number): string {
  return pluralRu(n, "день подряд", "дня подряд", "дней подряд");
}

export function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

export function formatRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
