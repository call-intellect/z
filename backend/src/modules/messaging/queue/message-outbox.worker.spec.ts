import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { TrackerGateway } from '../../tracker/gateways/tracker.gateway';
import type { PresenceService } from '../services/presence.service';

import type { ChatIngestQueueService } from './chat-ingest.queue.service';
import type { MessageOutboxQueueService } from './message-outbox.queue.service';
import { assertNoExternalBody, MessageOutboxRelayWorker } from './message-outbox.worker';

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    tenantId: 'org-1',
    conversationId: 'conv-1',
    seq: 5n,
    authorUserId: 'author-1',
    authorType: 'human',
    access: 'normal',
    content: 'gcm:v1:hello secret',
    parentMessageId: null,
    voiceUrl: null,
    voiceDuration: null,
    mentions: [],
    reactions: null,
    createdAt: new Date('2026-06-28T00:00:00.000Z'),
    ...overrides,
  };
}

interface Deps {
  outboxStatus: string | null;
  members: Array<{ userId: string; mutedUntil: Date | null }>;
  online: Array<{ userId: string; displayName: string }>;
  messageAccess?: string;
  messageAuthorType?: string;
  feedsGraph?: boolean;
  ingestEnabled?: boolean;
}

function build(deps: Deps) {
  const outboxRow = deps.outboxStatus == null ? null : { messageId: 'msg-1', status: deps.outboxStatus };
  const updateOutbox = vi.fn().mockResolvedValue({});
  const messageOverrides: Record<string, unknown> = {};
  if (deps.messageAccess) messageOverrides.access = deps.messageAccess;
  if (deps.messageAuthorType) messageOverrides.authorType = deps.messageAuthorType;
  const prisma = {
    messageOutbox: {
      findUnique: vi.fn().mockResolvedValue(outboxRow),
      update: updateOutbox,
    },
    message: {
      findUnique: vi.fn().mockResolvedValue(makeMessageRow(messageOverrides)),
    },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ feedsGraph: deps.feedsGraph ?? true }),
    },
    conversationMember: { findMany: vi.fn().mockResolvedValue(deps.members) },
  } as unknown as PrismaService;

  const crypto = {
    decrypt: vi.fn((v: string) => v.replace(/^gcm:v1:/, '')),
  } as unknown as CryptoService;

  const emitToRooms = vi.fn();
  const gateway = {
    conversationRoom: (id: string) => `conversation:${id}`,
    conversationStaffRoom: (id: string) => `conversation:${id}:staff`,
    emitToRooms,
  } as unknown as TrackerGateway;

  const sendNotification = vi.fn().mockResolvedValue({});
  const conversational = { sendNotification } as unknown as ConversationalService;

  const presence = {
    collect: vi.fn().mockResolvedValue(deps.online),
  } as unknown as PresenceService;

  const queue = { enqueue: vi.fn() } as unknown as MessageOutboxQueueService;
  const chatIngestEnqueue = vi.fn().mockResolvedValue(undefined);
  const chatIngestQueue = { enqueue: chatIngestEnqueue } as unknown as ChatIngestQueueService;
  const redis = { client: {} } as unknown as RedisService;
  const cfg = {
    getDynamic: vi.fn().mockResolvedValue(30),
    chat: { enabled: true, ingestEnabled: deps.ingestEnabled ?? true },
  } as unknown as TypedConfigService;

  const worker = new MessageOutboxRelayWorker(
    redis,
    prisma,
    crypto,
    gateway,
    conversational,
    presence,
    queue,
    chatIngestQueue,
    cfg,
  );

  return { worker, emitToRooms, sendNotification, updateOutbox, prisma, chatIngestEnqueue };
}

describe('MessageOutboxRelayWorker.relay — идемпотентность', () => {
  it('outbox status=sent → no-op: emit и notify НЕ вызваны', async () => {
    const { worker, emitToRooms, sendNotification, updateOutbox } = build({
      outboxStatus: 'sent',
      members: [{ userId: 'm1', mutedUntil: null }],
      online: [],
    });

    await worker.relay('msg-1');

    expect(emitToRooms).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(updateOutbox).not.toHaveBeenCalled();
  });

  it('pending → emit message.new + mark sent', async () => {
    const { worker, emitToRooms, updateOutbox } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
    });

    await worker.relay('msg-1');

    expect(emitToRooms).toHaveBeenCalledTimes(1);
    const [rooms, event] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['conversation:conv-1']);
    expect(event).toBe('message.new');
    expect(updateOutbox).toHaveBeenCalledWith({
      where: { messageId: 'msg-1' },
      data: { status: 'sent' },
    });
  });

  it('повторный job того же messageId (после sent) = no-op', async () => {
    const { worker: w1 } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
    });
    await w1.relay('msg-1');

    const { worker: w2, emitToRooms, sendNotification } = build({
      outboxStatus: 'sent',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
    });
    await w2.relay('msg-1');
    expect(emitToRooms).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('MessageOutboxRelayWorker — chat.ingest триггер', () => {
  it('feedsGraph=true + не system → enqueue chat.ingest', async () => {
    const { worker, chatIngestEnqueue } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      feedsGraph: true,
    });

    await worker.relay('msg-1');

    expect(chatIngestEnqueue).toHaveBeenCalledTimes(1);
    expect(chatIngestEnqueue).toHaveBeenCalledWith('msg-1');
  });

  it('feedsGraph=false → НЕ enqueue chat.ingest', async () => {
    const { worker, chatIngestEnqueue } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      feedsGraph: false,
    });

    await worker.relay('msg-1');

    expect(chatIngestEnqueue).not.toHaveBeenCalled();
  });

  it('authorType=system → НЕ enqueue chat.ingest', async () => {
    const { worker, chatIngestEnqueue } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      feedsGraph: true,
      messageAuthorType: 'system',
    });

    await worker.relay('msg-1');

    expect(chatIngestEnqueue).not.toHaveBeenCalled();
  });

  it('CHAT_INGEST_ENABLED=false → НЕ enqueue chat.ingest', async () => {
    const { worker, chatIngestEnqueue } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      feedsGraph: true,
      ingestEnabled: false,
    });

    await worker.relay('msg-1');

    expect(chatIngestEnqueue).not.toHaveBeenCalled();
  });
});

describe('MessageOutboxRelayWorker — офлайн-сигнал ФЗ-41', () => {
  it('офлайн-получателю шлётся сигнал БЕЗ content и без имён', async () => {
    const { worker, sendNotification } = build({
      outboxStatus: 'pending',
      members: [
        { userId: 'author-1', mutedUntil: null },
        { userId: 'offline-1', mutedUntil: null },
      ],
      online: [],
    });

    await worker.relay('msg-1');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const arg = sendNotification.mock.calls[0]![0];
    expect(arg.eventType).toBe('chat.new_message');
    expect(arg.recipientUserId).toBe('offline-1');
    expect(arg.payload).toEqual({ conversationId: 'conv-1' });
    expect(arg.payload).not.toHaveProperty('content');
    expect(arg.payload).not.toHaveProperty('authorName');
    expect(arg.payload).not.toHaveProperty('authorUserId');
    expect(arg.payload).not.toHaveProperty('displayName');
    expect(arg.payload).not.toHaveProperty('text');
    expect(arg.payload).not.toHaveProperty('body');
    expect(JSON.stringify(arg.payload)).not.toContain('hello secret');
  });

  it('онлайн-член (в presence) офлайн-сигнал НЕ получает', async () => {
    const { worker, sendNotification } = build({
      outboxStatus: 'pending',
      members: [
        { userId: 'author-1', mutedUntil: null },
        { userId: 'online-1', mutedUntil: null },
      ],
      online: [{ userId: 'online-1', displayName: 'Bob' }],
    });

    await worker.relay('msg-1');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('assertNoExternalBody бросает при теле во внешнем канале', () => {
    expect(() => assertNoExternalBody({ conversationId: 'c1' })).not.toThrow();
    expect(() => assertNoExternalBody({ conversationId: 'c1', content: 'hi' })).toThrow();
    expect(() => assertNoExternalBody({ conversationId: 'c1', authorName: 'Alice' })).toThrow();
    expect(() => assertNoExternalBody({ conversationId: 'c1', text: 'leak' })).toThrow();
  });
});

describe('MessageOutboxRelayWorker — relay-access (internal не клиенту)', () => {
  it('internal → message.new ТОЛЬКО в staff-room (не в общий room)', async () => {
    const { worker, emitToRooms } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      messageAccess: 'internal',
    });

    await worker.relay('msg-1');

    expect(emitToRooms).toHaveBeenCalledTimes(1);
    const [rooms] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['conversation:conv-1:staff']);
    expect(rooms).not.toContain('conversation:conv-1');
  });

  it('external → message.new в общий room (клиент-член его получает)', async () => {
    const { worker, emitToRooms } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      messageAccess: 'external',
    });

    await worker.relay('msg-1');

    const [rooms] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['conversation:conv-1']);
  });

  it('normal → message.new в общий room', async () => {
    const { worker, emitToRooms } = build({
      outboxStatus: 'pending',
      members: [{ userId: 'author-1', mutedUntil: null }],
      online: [],
      messageAccess: 'normal',
    });

    await worker.relay('msg-1');

    const [rooms] = emitToRooms.mock.calls[0]!;
    expect(rooms).toEqual(['conversation:conv-1']);
  });
});
