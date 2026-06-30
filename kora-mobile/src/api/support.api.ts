import { apiClient } from "./client";

export interface SupportTicketApi {
  conversationId: string;
  subject: string | null;
  status: string;
  slaBreachedAt: string | null;
  lastMessageAt: string | null;
  customerContact: string | null;
}

export interface SupportTicketsResponseApi {
  items: SupportTicketApi[];
}

export const supportApi = {
  deskTickets: () =>
    apiClient.get<SupportTicketsResponseApi>("/api/v1/support/desk/tickets"),

  myTickets: () =>
    apiClient.get<SupportTicketsResponseApi>("/api/v1/support/my-tickets"),
};
