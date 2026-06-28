import { z } from 'zod';

export const InboxThreadTypeSchema = z.enum([
  'all',
  'dm',
  'group',
  'channel',
  'work_chat',
  'external',
  'ticket',
  'unread',
]);
export type InboxThreadType = z.infer<typeof InboxThreadTypeSchema>;

export const InboxSortSchema = z.enum(['recent', 'active', 'unread']);
export type InboxSort = z.infer<typeof InboxSortSchema>;

export const ListThreadsQuerySchema = z
  .object({
    type: InboxThreadTypeSchema.default('all'),
    sort: InboxSortSchema.default('recent'),
    q: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListThreadsQuery = z.infer<typeof ListThreadsQuerySchema>;

export const SearchMessagesQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    type: InboxThreadTypeSchema.default('all'),
  })
  .strict();
export type SearchMessagesQuery = z.infer<typeof SearchMessagesQuerySchema>;

export interface InboxLinkedIssue {
  id: string;
  identifier: string;
  title: string;
}

export interface InboxItem {
  kind: 'dm' | 'group' | 'channel' | 'work_chat' | 'external' | 'ticket';
  refId: string;
  title: string;
  snippet: string;
  lastMessageAt: string | null;
  unreadCount: number;
  status: string | null;
  slaBreachedAt: string | null;
  linkedIssue: InboxLinkedIssue | null;
}

export interface ListThreadsResponse {
  items: InboxItem[];
  nextCursor: string | null;
}

export interface SearchMessageItem {
  conversationId: string;
  messageId: string;
  snippet: string;
}

export interface SearchMessagesResponse {
  items: SearchMessageItem[];
}

export interface UnreadCountResponse {
  total: number;
}
