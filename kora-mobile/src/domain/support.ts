import type { SupportTicketApi } from "@/api/support.api";

export interface SupportTicket {
  conversationId: string;
  subject: string;
  status: string;
  slaBreached: boolean;
  lastMessageAt: Date | null;
  customerContact: string | null;
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function supportTicketFromApi(api: SupportTicketApi): SupportTicket {
  return {
    conversationId: api.conversationId,
    subject: api.subject ?? "Без темы",
    status: api.status,
    slaBreached: api.slaBreachedAt !== null,
    lastMessageAt: parseDate(api.lastMessageAt),
    customerContact: api.customerContact,
  };
}

export function statusLabel(status: string): string {
  switch (status) {
    case "new":
      return "Новое";
    case "in_progress":
      return "В работе";
    case "waiting":
      return "Ожидание";
    case "resolved":
      return "Решено";
    case "closed":
      return "Закрыто";
    case "spam":
      return "Спам";
    default:
      return status;
  }
}
