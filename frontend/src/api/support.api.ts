/**
 * Support API — встроенная служба поддержки (ТЗ 2026-06-09 support-desk Ф1).
 *
 * Две стороны:
 *   - Клиент (`/api/v1/support/*`) — создать обращение, читать свои тикеты,
 *     дописать сообщение, оценить. Видит только access='external'.
 *   - Деск (`/api/v1/support/desk/*`) — сторона сотрудника поддержки
 *     (SupportAccessGuard на бэке): очередь, ответ, заметка, назначение,
 *     смена статуса. Видит все сообщения (internal+external).
 *   - Статус (`/api/v1/support/me`) — флаги для UI (виджет/сайдбар).
 *
 * Здесь только тонкие обёртки над единым `apiClient`. Контракты — см.
 * backend/src/modules/support/controllers/*.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';

// ─────────────────────────── ApiDto: клиент ───────────────────────────

export interface SupportStatusApi {
  deskEnabled: boolean;
  isAgent: boolean;
}

export interface SupportTicketCreatedApi {
  ticketId: string;
  ticketNumber: string;
}

export interface MyTicketListItemApi {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  updatedAt: string;
}

export interface MyTicketsListApi {
  items: MyTicketListItemApi[];
}

export interface MyTicketMessageApi {
  id: string;
  authorId: string;
  authorType: string;
  content: string;
  createdAt: string;
}

export interface MyTicketDetailApi {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  messages: MyTicketMessageApi[];
}

export interface SubmitTicketBody {
  subject: string;
  message: string;
  category?: string;
}

export interface ClientMessageBody {
  message: string;
}

export interface RateTicketBody {
  score: number;
  comment?: string;
}

// ─────────────────────────── ApiDto: деск ───────────────────────────

export interface DeskTicketListItemApi {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: string | null;
  slaBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeskTicketsListApi {
  items: DeskTicketListItemApi[];
  nextCursor: string | null;
}

export interface DeskTicketCommentApi {
  id: string;
  authorId: string;
  authorType: string;
  access: string;
  content: string;
  createdAt: string;
}

export interface DeskTicketDetailApi {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
  customerOrgId: string | null;
  customerUserId: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  slaBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: DeskTicketCommentApi[];
}

export interface DeskMetaStateApi {
  id: string;
  name: string;
  category: string;
}

export interface DeskMetaAgentApi {
  userId: string;
  name: string;
}

export interface DeskMetaApi {
  states: DeskMetaStateApi[];
  agents: DeskMetaAgentApi[];
}

/** Допустимые view очереди деска (контракт backend DeskListQuerySchema). */
export type DeskView = 'all' | 'unassigned' | 'mine' | 'closed' | 'spam';

export interface DeskReplyBody {
  message: string;
  fromDraftCommentId?: string;
}

export interface DeskNoteBody {
  message: string;
}

export interface DeskAssignBody {
  userId: string;
}

export interface DeskTransitionBody {
  stateId: string;
}

// ─────────────────────────── вызовы ───────────────────────────

export const supportApi = {
  // — статус —
  getStatus: () => apiClient.get<SupportStatusApi>('/api/v1/support/me'),

  // — клиент —
  submitTicket: (body: SubmitTicketBody) =>
    apiClient.post<SupportTicketCreatedApi>('/api/v1/support/tickets', body),

  listMyTickets: () =>
    apiClient.get<MyTicketsListApi>('/api/v1/support/my-tickets'),

  getMyTicket: (id: string) =>
    apiClient.get<MyTicketDetailApi>(
      `/api/v1/support/my-tickets/${encodeURIComponent(id)}`,
    ),

  addMyMessage: (id: string, body: ClientMessageBody) =>
    apiClient.post<{ ok: true; commentId: string }>(
      `/api/v1/support/my-tickets/${encodeURIComponent(id)}/messages`,
      body,
    ),

  rateMyTicket: (id: string, body: RateTicketBody) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/support/my-tickets/${encodeURIComponent(id)}/rate`,
      body,
    ),

  // — деск —
  listDeskTickets: (params: { view?: DeskView; cursor?: string } = {}) => {
    const qs = buildQuery({ view: params.view, cursor: params.cursor });
    return apiClient.get<DeskTicketsListApi>(
      `/api/v1/support/desk/tickets${qs}`,
    );
  },

  getDeskTicket: (id: string) =>
    apiClient.get<DeskTicketDetailApi>(
      `/api/v1/support/desk/tickets/${encodeURIComponent(id)}`,
    ),

  getDeskMeta: () => apiClient.get<DeskMetaApi>('/api/v1/support/desk/meta'),

  deskReply: (id: string, body: DeskReplyBody) =>
    apiClient.post<{ ok: true; commentId: string }>(
      `/api/v1/support/desk/tickets/${encodeURIComponent(id)}/reply`,
      body,
    ),

  deskNote: (id: string, body: DeskNoteBody) =>
    apiClient.post<{ ok: true; commentId: string }>(
      `/api/v1/support/desk/tickets/${encodeURIComponent(id)}/note`,
      body,
    ),

  deskAssign: (id: string, body: DeskAssignBody) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/support/desk/tickets/${encodeURIComponent(id)}/assign`,
      body,
    ),

  deskTransition: (id: string, body: DeskTransitionBody) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/support/desk/tickets/${encodeURIComponent(id)}/transition`,
      body,
    ),
};
