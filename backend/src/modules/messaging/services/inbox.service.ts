import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  InboxItem,
  InboxSort,
  InboxThreadType,
  ListThreadsResponse,
  SearchMessageItem,
  SearchMessagesResponse,
} from '../dto/inbox.dto';

interface ListThreadsArgs {
  tenantId: string;
  userId: string;
  type: InboxThreadType;
  sort: InboxSort;
  q?: string | null;
  cursor?: string | null;
}

interface SearchMessagesArgs {
  tenantId: string;
  userId: string;
  q: string;
}

interface ThreadCursor {
  k: string;
  id: string;
}

interface ConversationRow {
  id: string;
  kind: string;
  title: string | null;
  lastMessageAt: Date | null;
  members: Array<{ userId: string; lastReadSeq: bigint }>;
  supportTicket: { status: string; slaBreachedAt: Date | null } | null;
}

interface ThreadRow {
  id: string;
  kind: InboxItem['kind'];
  title: string;
  snippet: string;
  lastMessageAt: Date | null;
  unreadCount: number;
  messageCount: number;
  status: string | null;
  slaBreachedAt: Date | null;
  linkedIssue: InboxItem['linkedIssue'];
}

const PAGE_LIMIT = 30;
const SNIPPET_LIMIT = 120;
const UNREAD_BADGE_CACHE_TTL_SEC = 15;

export function encodeThreadCursor(cursor: ThreadCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeThreadCursor(raw: string): ThreadCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as ThreadCursor).k === 'string' &&
      typeof (parsed as ThreadCursor).id === 'string'
    ) {
      return parsed as ThreadCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function padNumber(value: number): string {
  return value.toString().padStart(18, '0');
}

export function sortKey(sort: InboxSort, row: Pick<ThreadRow, 'messageCount' | 'unreadCount' | 'lastMessageAt'>): string {
  if (sort === 'active') return padNumber(row.messageCount);
  if (sort === 'unread') return padNumber(row.unreadCount);
  return row.lastMessageAt ? row.lastMessageAt.toISOString() : '';
}

function compareDesc(a: ThreadRow, b: ThreadRow, sort: InboxSort): number {
  const ka = sortKey(sort, a);
  const kb = sortKey(sort, b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

function isAfterCursor(row: ThreadRow, cursor: ThreadCursor, sort: InboxSort): boolean {
  const k = sortKey(sort, row);
  if (k !== cursor.k) return k < cursor.k;
  return row.id < cursor.id;
}

@Injectable()
export class InboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async listThreads(args: ListThreadsArgs): Promise<ListThreadsResponse> {
    const rows = await this.loadThreadRows(args);
    const sorted = [...rows].sort((a, b) => compareDesc(a, b, args.sort));

    const cursor = args.cursor ? decodeThreadCursor(args.cursor) : null;
    const afterCursor = cursor
      ? sorted.filter((row) => isAfterCursor(row, cursor, args.sort))
      : sorted;

    const page = afterCursor.slice(0, PAGE_LIMIT);
    const hasMore = afterCursor.length > PAGE_LIMIT;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeThreadCursor({ k: sortKey(args.sort, last), id: last.id }) : null;

    return { items: page.map((row) => this.toItem(row)), nextCursor };
  }

  async unreadCount(args: { tenantId: string; userId: string }): Promise<number> {
    const cacheKey = `messaging:unread:${args.tenantId}:${args.userId}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached != null) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) return parsed;
    }

    const members = await this.prisma.conversationMember.findMany({
      where: { userId: args.userId, conversation: { tenantId: args.tenantId } },
      select: { conversationId: true, lastReadSeq: true },
    });
    if (members.length === 0) {
      await this.redis.client.set(cacheKey, '0', 'EX', UNREAD_BADGE_CACHE_TTL_SEC);
      return 0;
    }

    const maxSeqByConversation = await this.maxSeqByConversation(
      members.map((m) => m.conversationId),
    );

    let total = 0;
    for (const member of members) {
      const maxSeq = maxSeqByConversation.get(member.conversationId) ?? 0n;
      const unread = maxSeq - member.lastReadSeq;
      if (unread > 0n) total += Number(unread);
    }

    await this.redis.client.set(cacheKey, String(total), 'EX', UNREAD_BADGE_CACHE_TTL_SEC);
    return total;
  }

  async searchMessages(args: SearchMessagesArgs): Promise<SearchMessagesResponse> {
    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; messageId: string; snippet: string | null }>
    >`
      SELECT m."conversationId" AS "conversationId",
             m.id              AS "messageId",
             left(m."contentStripped", ${SNIPPET_LIMIT}) AS snippet
      FROM "Message" m
      JOIN "ConversationMember" cm
        ON cm."conversationId" = m."conversationId"
      JOIN "Conversation" c
        ON c.id = m."conversationId"
      WHERE cm."userId" = ${args.userId}
        AND c."tenantId" = ${args.tenantId}
        AND m."deletedAt" IS NULL
        AND to_tsvector('russian', coalesce(m."contentStripped", '')) @@ plainto_tsquery('russian', ${args.q})
      ORDER BY m."createdAt" DESC
      LIMIT 50
    `;

    const items: SearchMessageItem[] = rows.map((row) => ({
      conversationId: row.conversationId,
      messageId: row.messageId,
      snippet: (row.snippet ?? '').trim(),
    }));
    return { items };
  }

  private async loadThreadRows(args: ListThreadsArgs): Promise<ThreadRow[]> {
    const where: Prisma.ConversationWhereInput = {
      tenantId: args.tenantId,
      members: { some: { userId: args.userId } },
    };
    if (args.type !== 'all' && args.type !== 'unread') {
      where.kind = args.type;
    }

    const conversations = (await this.prisma.conversation.findMany({
      where,
      select: {
        id: true,
        kind: true,
        title: true,
        lastMessageAt: true,
        members: { select: { userId: true, lastReadSeq: true } },
        supportTicket: { select: { status: true, slaBreachedAt: true } },
      },
    })) as ConversationRow[];
    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c.id);
    const allUserIds = Array.from(
      new Set(conversations.flatMap((c) => c.members.map((m) => m.userId))),
    );

    const [maxSeqByConversation, countByConversation, lastMessages, namesByUser, issuesByConversation] =
      await Promise.all([
        this.maxSeqByConversation(conversationIds),
        this.messageCountByConversation(conversationIds),
        this.lastMessageByConversation(conversationIds),
        this.namesByUser(allUserIds),
        this.linkedIssuesByConversation(conversationIds),
      ]);

    const qLower = args.q ? args.q.toLowerCase() : null;

    const rows: ThreadRow[] = [];
    for (const conversation of conversations) {
      const selfMember = conversation.members.find((m) => m.userId === args.userId);
      const lastReadSeq = selfMember?.lastReadSeq ?? 0n;
      const maxSeq = maxSeqByConversation.get(conversation.id) ?? 0n;
      const unreadRaw = maxSeq - lastReadSeq;
      const unreadCount = unreadRaw > 0n ? Number(unreadRaw) : 0;

      if (args.type === 'unread' && unreadCount === 0) continue;

      const linkedIssue =
        conversation.kind === 'work_chat'
          ? issuesByConversation.get(conversation.id) ?? null
          : null;

      const title = this.resolveTitle(conversation, args.userId, namesByUser, linkedIssue);

      if (qLower && !this.matchesQuery(qLower, title, conversation, namesByUser, linkedIssue)) {
        continue;
      }

      rows.push({
        id: conversation.id,
        kind: conversation.kind as InboxItem['kind'],
        title,
        snippet: lastMessages.get(conversation.id) ?? '',
        lastMessageAt: conversation.lastMessageAt,
        unreadCount,
        messageCount: countByConversation.get(conversation.id) ?? 0,
        status: conversation.kind === 'ticket' ? conversation.supportTicket?.status ?? null : null,
        slaBreachedAt:
          conversation.kind === 'ticket'
            ? conversation.supportTicket?.slaBreachedAt ?? null
            : null,
        linkedIssue,
      });
    }
    return rows;
  }

  private resolveTitle(
    conversation: ConversationRow,
    selfUserId: string,
    namesByUser: Map<string, string>,
    linkedIssue: InboxItem['linkedIssue'],
  ): string {
    if (conversation.kind === 'work_chat' && linkedIssue) {
      if (conversation.title && conversation.title.trim().length > 0) return conversation.title;
      return `${linkedIssue.identifier} · ${linkedIssue.title}`;
    }
    if (conversation.title && conversation.title.trim().length > 0) return conversation.title;
    if (conversation.kind === 'dm') {
      const other = conversation.members.find((m) => m.userId !== selfUserId);
      const name = other ? namesByUser.get(other.userId) : undefined;
      if (name) return name;
    }
    const names = conversation.members
      .filter((m) => m.userId !== selfUserId)
      .map((m) => namesByUser.get(m.userId))
      .filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : 'Без названия';
  }

  private matchesQuery(
    qLower: string,
    title: string,
    conversation: ConversationRow,
    namesByUser: Map<string, string>,
    linkedIssue: InboxItem['linkedIssue'],
  ): boolean {
    if (title.toLowerCase().includes(qLower)) return true;
    if (
      conversation.members.some((m) => namesByUser.get(m.userId)?.toLowerCase().includes(qLower))
    ) {
      return true;
    }
    if (linkedIssue && linkedIssue.identifier.toLowerCase().includes(qLower)) return true;
    return false;
  }

  private async maxSeqByConversation(conversationIds: string[]): Promise<Map<string, bigint>> {
    if (conversationIds.length === 0) return new Map();
    const grouped = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds } },
      _max: { seq: true },
    });
    const map = new Map<string, bigint>();
    for (const g of grouped) map.set(g.conversationId, g._max.seq ?? 0n);
    return map;
  }

  private async messageCountByConversation(
    conversationIds: string[],
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();
    const grouped = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds }, deletedAt: null },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) map.set(g.conversationId, g._count._all);
    return map;
  }

  private async lastMessageByConversation(
    conversationIds: string[],
  ): Promise<Map<string, string>> {
    if (conversationIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; contentStripped: string | null }>
    >`
      SELECT DISTINCT ON (m."conversationId")
             m."conversationId"  AS "conversationId",
             m."contentStripped" AS "contentStripped"
      FROM "Message" m
      WHERE m."conversationId" IN (${Prisma.join(conversationIds)})
        AND m."deletedAt" IS NULL
      ORDER BY m."conversationId", m.seq DESC
    `;
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.conversationId, (row.contentStripped ?? '').trim().slice(0, SNIPPET_LIMIT));
    }
    return map;
  }

  private async namesByUser(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const map = new Map<string, string>();
    for (const u of users) map.set(u.id, u.name);
    return map;
  }

  private async linkedIssuesByConversation(
    conversationIds: string[],
  ): Promise<Map<string, InboxItem['linkedIssue']>> {
    if (conversationIds.length === 0) return new Map();
    const issues = await this.prisma.issue.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { id: true, identifier: true, title: true, conversationId: true },
    });
    const map = new Map<string, InboxItem['linkedIssue']>();
    for (const issue of issues) {
      if (!issue.conversationId) continue;
      map.set(issue.conversationId, {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
      });
    }
    return map;
  }

  private toItem(row: ThreadRow): InboxItem {
    return {
      kind: row.kind,
      refId: row.id,
      title: row.title,
      snippet: row.snippet,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      unreadCount: row.unreadCount,
      status: row.status,
      slaBreachedAt: row.slaBreachedAt ? row.slaBreachedAt.toISOString() : null,
      linkedIssue: row.linkedIssue,
    };
  }
}
