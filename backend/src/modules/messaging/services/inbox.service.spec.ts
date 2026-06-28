import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { decodeThreadCursor, encodeThreadCursor, InboxService, sortKey } from './inbox.service';

interface ConvSeed {
  id: string;
  kind: string;
  title: string | null;
  lastMessageAt: Date | null;
  members: Array<{ userId: string; lastReadSeq: bigint }>;
  supportTicket?: { status: string; slaBreachedAt: Date | null } | null;
  maxSeq: bigint;
  messageCount: number;
  lastSnippet: string | null;
}

interface SearchSeed {
  conversationId: string;
  messageId: string;
  snippet: string | null;
}

interface Seed {
  conversations: ConvSeed[];
  users: Array<{ id: string; name: string }>;
  issues: Array<{ id: string; identifier: string; title: string; conversationId: string }>;
  searchRows?: SearchSeed[];
}

function makePrisma(seed: Seed): PrismaService {
  return {
    conversation: {
      findMany: vi.fn().mockResolvedValue(
        seed.conversations.map((c) => ({
          id: c.id,
          kind: c.kind,
          title: c.title,
          lastMessageAt: c.lastMessageAt,
          members: c.members,
          supportTicket: c.supportTicket ?? null,
        })),
      ),
    },
    conversationMember: {
      findMany: vi.fn().mockResolvedValue(
        seed.conversations.flatMap((c) =>
          c.members.map((m) => ({ conversationId: c.id, lastReadSeq: m.lastReadSeq })),
        ),
      ),
    },
    message: {
      groupBy: vi.fn((args: { _max?: unknown; _count?: unknown }) => {
        if (args._max) {
          return Promise.resolve(
            seed.conversations.map((c) => ({ conversationId: c.id, _max: { seq: c.maxSeq } })),
          );
        }
        return Promise.resolve(
          seed.conversations.map((c) => ({
            conversationId: c.id,
            _count: { _all: c.messageCount },
          })),
        );
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findMany: vi.fn().mockResolvedValue(seed.users),
    },
    issue: {
      findMany: vi.fn().mockResolvedValue(seed.issues),
    },
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('plainto_tsquery')) {
        return Promise.resolve(seed.searchRows ?? []);
      }
      return Promise.resolve(
        seed.conversations.map((c) => ({
          conversationId: c.id,
          contentStripped: c.lastSnippet,
        })),
      );
    }),
  } as unknown as PrismaService;
}

function makeRedis(): { redis: RedisService; store: Map<string, string> } {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      set: vi.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve('OK');
      }),
    },
  } as unknown as RedisService;
  return { redis, store };
}

function conv(over: Partial<ConvSeed> & { id: string }): ConvSeed {
  return {
    kind: 'group',
    title: null,
    lastMessageAt: new Date('2026-06-01T00:00:00.000Z'),
    members: [{ userId: 'me', lastReadSeq: 0n }],
    maxSeq: 0n,
    messageCount: 0,
    lastSnippet: null,
    ...over,
  };
}

describe('cursor builder', () => {
  it('encode → decode round-trip', () => {
    const c = { k: '2026-06-01T00:00:00.000Z', id: 'x1' };
    expect(decodeThreadCursor(encodeThreadCursor(c))).toEqual(c);
  });

  it('битый курсор → null', () => {
    expect(decodeThreadCursor('@@@not-base64-json')).toBeNull();
    expect(decodeThreadCursor(Buffer.from('{"k":1}', 'utf8').toString('base64url'))).toBeNull();
  });

  it('sortKey: active/unread паддятся, recent = ISO lastMessageAt', () => {
    expect(sortKey('active', { messageCount: 7, unreadCount: 0, lastMessageAt: null })).toBe(
      '000000000000000007',
    );
    expect(sortKey('unread', { messageCount: 0, unreadCount: 3, lastMessageAt: null })).toBe(
      '000000000000000003',
    );
    const d = new Date('2026-06-01T00:00:00.000Z');
    expect(sortKey('recent', { messageCount: 0, unreadCount: 0, lastMessageAt: d })).toBe(
      d.toISOString(),
    );
  });
});

describe('InboxService.listThreads', () => {
  const baseSeed: Seed = {
    conversations: [
      conv({
        id: 'dm1',
        kind: 'dm',
        members: [
          { userId: 'me', lastReadSeq: 0n },
          { userId: 'bob', lastReadSeq: 0n },
        ],
        lastMessageAt: new Date('2026-06-03T00:00:00.000Z'),
        maxSeq: 5n,
        messageCount: 5,
        lastSnippet: 'привет от боба',
      }),
      conv({
        id: 'tkt1',
        kind: 'ticket',
        title: 'Не открывается отчёт',
        supportTicket: { status: 'in_progress', slaBreachedAt: new Date('2026-06-02T00:00:00.000Z') },
        lastMessageAt: new Date('2026-06-02T00:00:00.000Z'),
        maxSeq: 2n,
        messageCount: 2,
        lastSnippet: 'жду ответа',
      }),
      conv({
        id: 'wc1',
        kind: 'work_chat',
        lastMessageAt: new Date('2026-06-01T00:00:00.000Z'),
        maxSeq: 10n,
        messageCount: 10,
        lastSnippet: 'обсуждение задачи',
      }),
    ],
    users: [
      { id: 'me', name: 'Я' },
      { id: 'bob', name: 'Боб' },
    ],
    issues: [{ id: 'iss-1', identifier: 'PROJ-7', title: 'Починить отчёт', conversationId: 'wc1' }],
  };

  it('type=all отдаёт все kind члена; INV-A1: ticket несёт status/sla, work_chat — linkedIssue, прочие — null', async () => {
    const prisma = makePrisma(baseSeed);
    const { redis } = makeRedis();
    const svc = new InboxService(prisma, redis);

    const res = await svc.listThreads({
      tenantId: 't1',
      userId: 'me',
      type: 'all',
      sort: 'recent',
    });

    const byId = Object.fromEntries(res.items.map((i) => [i.refId, i]));
    expect(Object.keys(byId).sort()).toEqual(['dm1', 'tkt1', 'wc1']);

    expect(byId.tkt1!.status).toBe('in_progress');
    expect(byId.tkt1!.slaBreachedAt).toBe('2026-06-02T00:00:00.000Z');
    expect(byId.tkt1!.linkedIssue).toBeNull();

    expect(byId.wc1!.linkedIssue).toEqual({
      id: 'iss-1',
      identifier: 'PROJ-7',
      title: 'Починить отчёт',
    });
    expect(byId.wc1!.status).toBeNull();
    expect(byId.wc1!.slaBreachedAt).toBeNull();
    expect(byId.wc1!.title).toBe('PROJ-7 · Починить отчёт');

    expect(byId.dm1!.status).toBeNull();
    expect(byId.dm1!.slaBreachedAt).toBeNull();
    expect(byId.dm1!.linkedIssue).toBeNull();
    expect(byId.dm1!.title).toBe('Боб');
    expect(byId.dm1!.snippet).toBe('привет от боба');
  });

  it('sort=recent — свежее сверху', async () => {
    const svc = new InboxService(makePrisma(baseSeed), makeRedis().redis);
    const res = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'recent' });
    expect(res.items.map((i) => i.refId)).toEqual(['dm1', 'tkt1', 'wc1']);
  });

  it('sort=active — больше сообщений сверху', async () => {
    const svc = new InboxService(makePrisma(baseSeed), makeRedis().redis);
    const res = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'active' });
    expect(res.items.map((i) => i.refId)).toEqual(['wc1', 'dm1', 'tkt1']);
  });

  it('sort=unread — непрочитанные сверху', async () => {
    const seed: Seed = {
      ...baseSeed,
      conversations: [
        conv({ id: 'a', kind: 'group', maxSeq: 10n, members: [{ userId: 'me', lastReadSeq: 8n }] }),
        conv({ id: 'b', kind: 'group', maxSeq: 10n, members: [{ userId: 'me', lastReadSeq: 0n }] }),
        conv({ id: 'c', kind: 'group', maxSeq: 10n, members: [{ userId: 'me', lastReadSeq: 5n }] }),
      ],
    };
    const svc = new InboxService(makePrisma(seed), makeRedis().redis);
    const res = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'unread' });
    expect(res.items.map((i) => i.refId)).toEqual(['b', 'c', 'a']);
    expect(res.items.map((i) => i.unreadCount)).toEqual([10, 5, 2]);
  });

  it('type=unread фильтрует только непрочитанные', async () => {
    const seed: Seed = {
      ...baseSeed,
      conversations: [
        conv({ id: 'read', kind: 'group', maxSeq: 3n, members: [{ userId: 'me', lastReadSeq: 3n }] }),
        conv({ id: 'new', kind: 'group', maxSeq: 5n, members: [{ userId: 'me', lastReadSeq: 1n }] }),
      ],
    };
    const svc = new InboxService(makePrisma(seed), makeRedis().redis);
    const res = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'unread', sort: 'recent' });
    expect(res.items.map((i) => i.refId)).toEqual(['new']);
  });

  it('q фильтрует по title / имени участника / PROJ-NN', async () => {
    const svc = new InboxService(makePrisma(baseSeed), makeRedis().redis);

    const byName = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'recent', q: 'боб' });
    expect(byName.items.map((i) => i.refId)).toEqual(['dm1']);

    const byTitle = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'recent', q: 'отчёт' });
    expect(byTitle.items.map((i) => i.refId).sort()).toEqual(['tkt1', 'wc1']);

    const byProj = await svc.listThreads({ tenantId: 't1', userId: 'me', type: 'all', sort: 'recent', q: 'proj-7' });
    expect(byProj.items.map((i) => i.refId)).toEqual(['wc1']);
  });

  it('курсор: ≥2 страницы без дублей и пропусков (sort=recent)', async () => {
    const conversations: ConvSeed[] = [];
    for (let i = 0; i < 65; i++) {
      const n = String(i).padStart(3, '0');
      conversations.push(
        conv({
          id: `c${n}`,
          kind: 'group',
          lastMessageAt: new Date(2026, 0, 1, 0, 0, i),
          maxSeq: 1n,
          messageCount: 1,
        }),
      );
    }
    const seed: Seed = { conversations, users: [{ id: 'me', name: 'Я' }], issues: [] };
    const svc = new InboxService(makePrisma(seed), makeRedis().redis);

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: { refId: string }[]; nextCursor: string | null } = await svc.listThreads({
        tenantId: 't1',
        userId: 'me',
        type: 'all',
        sort: 'recent',
        cursor,
      });
      pages++;
      for (const item of page.items) {
        expect(seen.has(item.refId)).toBe(false);
        seen.add(item.refId);
      }
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages).toBeGreaterThanOrEqual(2);
    expect(seen.size).toBe(65);
  });
});

describe('InboxService.unreadCount', () => {
  it('сумма unread по всем разговорам члена', async () => {
    const seed: Seed = {
      conversations: [
        conv({ id: 'a', maxSeq: 10n, members: [{ userId: 'me', lastReadSeq: 7n }] }),
        conv({ id: 'b', maxSeq: 5n, members: [{ userId: 'me', lastReadSeq: 5n }] }),
        conv({ id: 'c', maxSeq: 4n, members: [{ userId: 'me', lastReadSeq: 0n }] }),
      ],
      users: [],
      issues: [],
    };
    const svc = new InboxService(makePrisma(seed), makeRedis().redis);
    expect(await svc.unreadCount({ tenantId: 't1', userId: 'me' })).toBe(7);
  });

  it('кэширует результат в Redis', async () => {
    const seed: Seed = {
      conversations: [conv({ id: 'a', maxSeq: 3n, members: [{ userId: 'me', lastReadSeq: 0n }] })],
      users: [],
      issues: [],
    };
    const { redis, store } = makeRedis();
    const svc = new InboxService(makePrisma(seed), redis);
    await svc.unreadCount({ tenantId: 't1', userId: 'me' });
    expect(store.get('messaging:unread:t1:me')).toBe('3');
  });
});

describe('InboxService.searchMessages', () => {
  it('возвращает совпадения с обрезанным snippet (scope члена в SQL)', async () => {
    const seed: Seed = {
      conversations: [],
      users: [],
      issues: [],
      searchRows: [
        { conversationId: 'c1', messageId: 'm1', snippet: '  нашёл фрагмент  ' },
        { conversationId: 'c2', messageId: 'm2', snippet: null },
      ],
    };
    const prisma = makePrisma(seed);
    const svc = new InboxService(prisma, makeRedis().redis);
    const res = await svc.searchMessages({ tenantId: 't1', userId: 'me', q: 'фрагмент' });
    expect(res.items).toEqual([
      { conversationId: 'c1', messageId: 'm1', snippet: 'нашёл фрагмент' },
      { conversationId: 'c2', messageId: 'm2', snippet: '' },
    ]);
  });
});
