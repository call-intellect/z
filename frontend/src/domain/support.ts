/**
 * DomainModel службы поддержки (ТЗ 2026-06-09 support-desk Ф1).
 *
 * Слой ApiDto → DomainModel: компоненты работают только с этими моделями
 * (ISO-строки преобразованы в Date, готовы к форматированию). Мапперы —
 * чистые функции без побочных эффектов.
 */

import type {
  DeskMetaApi,
  DeskMetaAgentApi,
  DeskMetaStateApi,
  DeskTicketCommentApi,
  DeskTicketDetailApi,
  DeskTicketListItemApi,
  MyTicketDetailApi,
  MyTicketListItemApi,
  MyTicketMessageApi,
  SupportStatusApi,
} from '../api/support.api';

// ─────────────────────────── статус ───────────────────────────

export interface SupportStatus {
  deskEnabled: boolean;
  isAgent: boolean;
}

export function toSupportStatus(dto: SupportStatusApi): SupportStatus {
  return { deskEnabled: dto.deskEnabled, isAgent: dto.isAgent };
}

// ─────────────────────────── клиент ───────────────────────────

export interface SupportTicketListItem {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  updatedAt: Date;
}

export interface SupportMessage {
  id: string;
  authorId: string;
  authorType: string;
  content: string;
  createdAt: Date;
}

export interface SupportTicketDetail {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: SupportMessage[];
}

export function toSupportTicketListItem(
  dto: MyTicketListItemApi,
): SupportTicketListItem {
  return {
    ticketId: dto.ticketId,
    ticketNumber: dto.ticketNumber,
    subject: dto.subject,
    status: dto.status,
    updatedAt: new Date(dto.updatedAt),
  };
}

export function toSupportMessage(dto: MyTicketMessageApi): SupportMessage {
  return {
    id: dto.id,
    authorId: dto.authorId,
    authorType: dto.authorType,
    content: dto.content,
    createdAt: new Date(dto.createdAt),
  };
}

export function toSupportTicketDetail(
  dto: MyTicketDetailApi,
): SupportTicketDetail {
  return {
    ticketId: dto.ticketId,
    ticketNumber: dto.ticketNumber,
    subject: dto.subject,
    status: dto.status,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    messages: dto.messages.map(toSupportMessage),
  };
}

// ─────────────────────────── деск ───────────────────────────

export interface DeskTicketListItem {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: Date | null;
  slaBreachedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeskMessage {
  id: string;
  authorId: string;
  authorType: string;
  /** 'external' (видно клиенту) | 'internal' (заметка). */
  access: string;
  content: string;
  createdAt: Date;
}

export interface DeskTicketDetail {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  customerOrgId: string | null;
  customerUserId: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstRespondedAt: Date | null;
  slaBreachedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: DeskMessage[];
}

export interface SupportMetaState {
  id: string;
  name: string;
  category: string;
}

export interface SupportMetaAgent {
  userId: string;
  name: string;
}

export interface SupportMeta {
  states: SupportMetaState[];
  agents: SupportMetaAgent[];
}

function toDateOrNull(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

export function toDeskTicketListItem(
  dto: DeskTicketListItemApi,
): DeskTicketListItem {
  return {
    ticketId: dto.ticketId,
    ticketNumber: dto.ticketNumber,
    subject: dto.subject,
    status: dto.status,
    customerContact: dto.customerContact,
    assigneeUserIds: dto.assigneeUserIds,
    firstResponseDueAt: toDateOrNull(dto.firstResponseDueAt),
    slaBreachedAt: toDateOrNull(dto.slaBreachedAt),
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
  };
}

export function toDeskMessage(dto: DeskTicketCommentApi): DeskMessage {
  return {
    id: dto.id,
    authorId: dto.authorId,
    authorType: dto.authorType,
    access: dto.access,
    content: dto.content,
    createdAt: new Date(dto.createdAt),
  };
}

export function toDeskTicketDetail(dto: DeskTicketDetailApi): DeskTicketDetail {
  return {
    ticketId: dto.ticketId,
    ticketNumber: dto.ticketNumber,
    subject: dto.subject,
    status: dto.status,
    customerOrgId: dto.customerOrgId,
    customerUserId: dto.customerUserId,
    customerContact: dto.customerContact,
    assigneeUserIds: dto.assigneeUserIds,
    firstResponseDueAt: toDateOrNull(dto.firstResponseDueAt),
    resolutionDueAt: toDateOrNull(dto.resolutionDueAt),
    firstRespondedAt: toDateOrNull(dto.firstRespondedAt),
    slaBreachedAt: toDateOrNull(dto.slaBreachedAt),
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
    messages: dto.messages.map(toDeskMessage),
  };
}

function toSupportMetaState(dto: DeskMetaStateApi): SupportMetaState {
  return { id: dto.id, name: dto.name, category: dto.category };
}

function toSupportMetaAgent(dto: DeskMetaAgentApi): SupportMetaAgent {
  return { userId: dto.userId, name: dto.name };
}

export function toSupportMeta(dto: DeskMetaApi): SupportMeta {
  return {
    states: dto.states.map(toSupportMetaState),
    agents: dto.agents.map(toSupportMetaAgent),
  };
}

/**
 * Считается ли тикет «закрытым» по названию статуса — для показа CSAT-оценки
 * клиенту. Бэк не отдаёт category в клиентском детале, поэтому матчим по
 * человекочитаемым названиям статусов Support-проекта.
 */
export function isTicketResolvedStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s.includes('решен') ||
    s.includes('закрыт') ||
    s.includes('выполн') ||
    s.includes('готов')
  );
}
