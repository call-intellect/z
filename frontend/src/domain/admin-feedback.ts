import type {
  FeedbackFailedMessageApi,
  FeedbackFailedMessagesListApi,
  FeedbackItemApi,
  FeedbackItemMessageApi,
  FeedbackItemsListApi,
  FeedbackTopicDetailApi,
  FeedbackTopicStatusApi,
  FeedbackTopicSummaryApi,
  FeedbackTopicsListApi,
} from "@/api/admin-feedback.api";

export type FeedbackTopicStatus = "active" | "archived" | "merged";

export interface FeedbackTopicSummary {
  id: string;
  title: string;
  description: string;
  status: FeedbackTopicStatus;
  itemsCount: number;
  uniqueUsersCount: number;
  percentOfWindow: number;
  lastItemAt: Date | null;
  createdAt: Date;
}

export interface FeedbackTopicDetail extends FeedbackTopicSummary {
  archivedAt: Date | null;
  updatedAt: Date;
  mergedIntoId: string | null;
}

export interface FeedbackTopicsList {
  items: FeedbackTopicSummary[];
  totalItemsInWindow: number;
  totalUsersInWindow: number;
  totalTopicsInWindow: number;
  page: number;
  pageSize: number;
}

export interface FeedbackItemAuthor {
  id: string;
  email: string;
  name: string | null;
}

export interface FeedbackItemOrg {
  id: string;
  name: string;
}

export interface FeedbackItem {
  id: string;
  text: string;
  createdAt: Date;
  messageId: string;
  user: FeedbackItemAuthor;
  org: FeedbackItemOrg | null;
  discarded: boolean;
  discardReason: string | null;
}

export interface FeedbackItemsList {
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeedbackItemMessage {
  id: string;
  text: string;
  createdAt: Date;
  userId: string;
  orgId: string | null;
  user: FeedbackItemAuthor;
  org: FeedbackItemOrg | null;
}

export interface FeedbackFailedMessage {
  id: string;
  userId: string;
  userEmail: string;
  text: string;
  createdAt: Date;
  failedRuns: number;
}

export interface FeedbackFailedMessagesList {
  items: FeedbackFailedMessage[];
  total: number;
  page: number;
  pageSize: number;
}

function statusFromApi(api: FeedbackTopicStatusApi): FeedbackTopicStatus {
  switch (api) {
    case "ACTIVE":
      return "active";
    case "ARCHIVED":
      return "archived";
    case "MERGED":
      return "merged";
  }
}

export function toFeedbackTopicSummary(
  dto: FeedbackTopicSummaryApi,
): FeedbackTopicSummary {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    status: statusFromApi(dto.status),
    itemsCount: dto.itemsCount,
    uniqueUsersCount: dto.uniqueUsersCount,
    percentOfWindow: dto.percentOfWindow,
    lastItemAt: dto.lastItemAt ? new Date(dto.lastItemAt) : null,
    createdAt: new Date(dto.createdAt),
  };
}

export function toFeedbackTopicsList(
  dto: FeedbackTopicsListApi,
): FeedbackTopicsList {
  return {
    items: dto.items.map(toFeedbackTopicSummary),
    totalItemsInWindow: dto.totalItemsInWindow,
    totalUsersInWindow: dto.totalUsersInWindow,
    totalTopicsInWindow: dto.totalTopicsInWindow,
    page: dto.page,
    pageSize: dto.pageSize,
  };
}

export function toFeedbackTopicDetail(
  dto: FeedbackTopicDetailApi,
): FeedbackTopicDetail {
  return {
    ...toFeedbackTopicSummary(dto),
    archivedAt: dto.archivedAt ? new Date(dto.archivedAt) : null,
    updatedAt: new Date(dto.updatedAt),
    mergedIntoId: dto.mergedIntoId,
  };
}

export function toFeedbackItem(dto: FeedbackItemApi): FeedbackItem {
  return {
    id: dto.id,
    text: dto.text,
    createdAt: new Date(dto.createdAt),
    messageId: dto.messageId,
    user: { ...dto.user },
    org: dto.org ? { ...dto.org } : null,
    discarded: dto.discarded,
    discardReason: dto.discardReason,
  };
}

export function toFeedbackItemsList(
  dto: FeedbackItemsListApi,
): FeedbackItemsList {
  return {
    items: dto.items.map(toFeedbackItem),
    total: dto.total,
    page: dto.page,
    pageSize: dto.pageSize,
  };
}

export function toFeedbackItemMessage(
  dto: FeedbackItemMessageApi,
): FeedbackItemMessage {
  return {
    id: dto.id,
    text: dto.text,
    createdAt: new Date(dto.createdAt),
    userId: dto.userId,
    orgId: dto.orgId,
    user: { ...dto.user },
    org: dto.org ? { ...dto.org } : null,
  };
}

export function toFeedbackFailedMessage(
  dto: FeedbackFailedMessageApi,
): FeedbackFailedMessage {
  return {
    id: dto.id,
    userId: dto.userId,
    userEmail: dto.userEmail,
    text: dto.text,
    createdAt: new Date(dto.createdAt),
    failedRuns: dto.failedRuns,
  };
}

export function toFeedbackFailedMessagesList(
  dto: FeedbackFailedMessagesListApi,
): FeedbackFailedMessagesList {
  return {
    items: dto.items.map(toFeedbackFailedMessage),
    total: dto.total,
    page: dto.page,
    pageSize: dto.pageSize,
  };
}

export const FEEDBACK_TOPIC_STATUS_LABEL: Record<FeedbackTopicStatus, string> =
  {
    active: "Активный",
    archived: "Архив",
    merged: "Слит",
  };

export type FeedbackWindow = "30" | "90" | "all";

export const FEEDBACK_WINDOW_LABEL: Record<FeedbackWindow, string> = {
  "30": "30 дней",
  "90": "90 дней",
  all: "За всё время",
};

export type FeedbackSort = "percent" | "users" | "recent";

export const FEEDBACK_SORT_LABEL: Record<FeedbackSort, string> = {
  percent: "По доле",
  users: "По числу юзеров",
  recent: "По свежести",
};

export function formatAuthor(user: FeedbackItemAuthor): string {
  if (user.name && user.name.trim().length > 0) {
    return `${user.name} · ${user.email}`;
  }
  return user.email;
}
