import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { TrackerGateway } from '../../tracker/gateways/tracker.gateway';
import type { PresenceService } from '../services/presence.service';

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
}

function build(deps: Deps) {
  const outboxRow = deps.outboxStatus == null ? null : { messageId: 'msg-1', status: deps.outboxStatus };
  const updateOutbox = vi.fn().mockResolvedValue({});
  const prisma = {
    messageOutbox: {
      findUnique: vi.fn().mockResolvedValue(outboxRow),
      update: updateOutbox,
    },
    message: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          makeMessageRow(deps.messageAccess ? { access: deps.messageAccess } : {}),
        ),
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
  const redis = { client: {} } as unknown as RedisService;
  const cfg = { getDynamic: vi.fn().mockResolvedValue(30) } as unknown as TypedConfigService;

  const worker = new MessageOutboxRelayWorker(
    redis,
    prisma,
    crypto,
    gateway,
    conversational,
    presence,
    queue,
    cfg,
  );

  return { worker, emitToRooms, sendNotification, updateOutbox, prisma };
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
