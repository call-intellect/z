import type {
  AskAllFormersResponseApi,
  AskCloneResponseApi,
  AskFormerAnswerApi,
  CloneCitationApi,
  CloneConversationListItemApi,
  CloneListItemApi,
  CloneVersionApi,
} from "../api/clones.api";
import type { MyCloneAccessResponseApi } from "../api/me-clone-access.api";

export interface CloneCitation {
  blockId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  startMs: number | null;
  endMs: number | null;
  snippet: string | null;
}

export interface CloneAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitation[];
  isOwner: boolean;
  refused: boolean;
  refusalReason: string | null;
}

export function mapCloneCitation(api: CloneCitationApi): CloneCitation {
  return {
    blockId: api.blockId,
    meetingId: api.meetingId ?? null,
    meetingTitle: api.meetingTitle ?? null,
    startMs: api.startMs ?? null,
    endMs: api.endMs ?? null,
    snippet: api.snippet ?? null,
  };
}

export function mapCloneAnswer(api: AskCloneResponseApi): CloneAnswer {
  return {
    conversationId: api.conversationId,
    messageId: api.messageId,
    text: api.text,
    citations: api.citations.map(mapCloneCitation),
    isOwner: api.isOwner,
    refused: api.refused ?? false,
    refusalReason: api.refusalReason ?? null,
  };
}

export interface CloneConversationUiItem {
  id: string;
  title: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  messageCount: number;
}

export function mapCloneConversation(
  api: CloneConversationListItemApi,
): CloneConversationUiItem {
  return {
    id: api.id,
    title: api.title,
    lastMessageAt: new Date(api.lastMessageAt),
    createdAt: new Date(api.createdAt),
    messageCount: api.messageCount,
  };
}

export interface MyCloneAccessMap {
  fetchedAt: Date;
  roleClones: Set<string>;
  personClones: Set<string>;
  has(cloneType: "role" | "person", cloneRefId: string): boolean;
}

export function mapMyCloneAccess(
  api: MyCloneAccessResponseApi,
): MyCloneAccessMap {
  const roleSet = new Set(api.roleClones);
  const personSet = new Set(api.personClones);
  return {
    fetchedAt: new Date(api.fetchedAt),
    roleClones: roleSet,
    personClones: personSet,
    has(cloneType, cloneRefId) {
      return cloneType === "role"
        ? roleSet.has(cloneRefId)
        : personSet.has(cloneRefId);
    },
  };
}

export function cloneRefusalReasonRu(
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "topic_starved":
      return "В архиве недостаточно обсуждений по этой теме — клон не может ответить с опорой на источники.";
    default:
      return "Клон отказался отвечать на этот вопрос.";
  }
}

export interface CloneListUiItem {
  personaId: string;
  roleId: string;
  roleName: string;
  departmentName: string | null;
  departmentId: string | null;
  version: number;
  publicName: string;
  status: CloneVersionStatus;
  bearerName: string | null;
  bearerPersonId: string | null;
  confidencePct: number;
  traitsCount: number;
  lastBuildAt: Date;
}

export function mapCloneListItem(api: CloneListItemApi): CloneListUiItem {
  return {
    personaId: api.personaId,
    roleId: api.roleId,
    roleName: api.roleName,
    departmentName: api.departmentName,
    departmentId: api.departmentId,
    version: api.version,
    publicName: api.publicName,
    status: api.status,
    bearerName: api.currentBearer?.personName ?? null,
    bearerPersonId: api.currentBearer?.personId ?? null,
    confidencePct: Math.round((api.confidence ?? 0) * 100),
    traitsCount: api.traitsCount,
    lastBuildAt: new Date(api.lastBuildAt),
  };
}

export type CloneVersionStatus =
  | "active"
  | "superseded"
  | "pending_rebuild"
  | "frozen";

export interface CloneVersionUiItem {
  personaId: string;
  roleId: string;
  version: number;
  publicName: string;
  status: CloneVersionStatus;
  bearerName: string | null;
  bearerPersonId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  confidencePct: number;
  traitsCount: number;
}

export function mapCloneVersion(api: CloneVersionApi): CloneVersionUiItem {
  return {
    personaId: api.personaId,
    roleId: api.roleId,
    version: api.version,
    publicName: api.publicName,
    status: api.status,
    bearerName: api.bearer?.personName ?? null,
    bearerPersonId: api.bearer?.personId ?? null,
    validFrom: new Date(api.validFrom),
    validUntil: api.validUntil ? new Date(api.validUntil) : null,
    confidencePct: Math.round((api.confidence ?? 0) * 100),
    traitsCount: api.traitsCount,
  };
}

export interface CloneStatusBadge {
  label: string;
  variant: "success" | "warning" | "secondary" | "default";
}

export function cloneVersionStatusBadge(
  status: CloneVersionStatus,
): CloneStatusBadge {
  switch (status) {
    case "active":
      return { label: "Текущий", variant: "success" };
    case "frozen":
      return { label: "Заморожен (бывший носитель)", variant: "warning" };
    case "pending_rebuild":
      return { label: "Клон обновляется", variant: "secondary" };
    case "superseded":
      return { label: "Архив", variant: "secondary" };
    default:
      return { label: "Версия", variant: "secondary" };
  }
}

export interface FormerAnswerUiItem {
  personaId: string;
  version: number;
  publicName: string;
  status: "active" | "frozen";
  answer: CloneAnswer | null;
  error: string | null;
}

export function mapFormerAnswer(api: AskFormerAnswerApi): FormerAnswerUiItem {
  return {
    personaId: api.personaId,
    version: api.version,
    publicName: api.publicName,
    status: api.status,
    answer: api.response ? mapCloneAnswer(api.response) : null,
    error: api.error,
  };
}

export interface AllFormersUiResult {
  roleId: string;
  roleName: string;
  question: string;
  answers: FormerAnswerUiItem[];
}

export function mapAllFormers(
  api: AskAllFormersResponseApi,
): AllFormersUiResult {
  return {
    roleId: api.roleId,
    roleName: api.roleName,
    question: api.question,
    answers: api.answers.map(mapFormerAnswer),
  };
}
