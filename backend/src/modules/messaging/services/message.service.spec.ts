import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MessageOutboxQueueService } from '../queue/message-outbox.queue.service';

import { MessageService } from './message.service';

function makeOutboxQueue() {
  return {
    enqueue: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageOutboxQueueService & { enqueue: ReturnType<typeof vi.fn> };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    tenantId: 'org-1',
    conversationId: 'conv-1',
    seq: 1n,
    authorUserId: 'user-1',
    authorType: 'human',
    access: 'normal',
    content: 'gcm:v1:enc',
    contentHtml: null,
    contentStripped: null,
    parentMessageId: null,
    clientMessageId: 'cmid-1',
    voiceUrl: null,
    voiceDuration: null,
    voiceTranscript: null,
    attachments: null,
    mentions: [],
    reactions: null,
    thanksUserIds: [],
    draftState: null,
    cloneConfidence: null,
    groundednessScore: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-06-28T00:00:00.000Z'),
    ...overrides,
  };
}

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeCrypto() {
  return {
    encrypt: vi.fn((plaintext: string) => `gcm:v1:${plaintext}`),
    decrypt: vi.fn((encoded: string) => encoded.replace(/^gcm:v1:/, '')),
    isEncrypted: vi.fn(() => true),
  } as unknown as CryptoService & {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  };
}

function makeCfg(enabled = true) {
  return { chat: { enabled } } as unknown as TypedConfigService;
}

function makeTx(maxSeq: bigint | null, createImpl: (data: unknown) => unknown) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'conv-1' }]),
    message: {
      aggregate: vi.fn().mockResolvedValue({ _max: { seq: maxSeq } }),
      create: vi.fn((args: { data: unknown }) => Promise.resolve(createImpl(args.data))),
    },
    messageOutbox: { create: vi.fn().mockResolvedValue({}) },
    conversation: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe('MessageService.sendMessage', () => {
  let crypto: ReturnType<typeof makeCrypto>;

  beforeEach(() => {
    crypto = makeCrypto();
  });

  it('CHAT_ENABLED=false → 503 CHAT_DISABLED, запись не вызвана', async () => {
    const prisma = {
      message: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(false), makeOutboxQueue());

    await expect(
      service.sendMessage({
        tenantId: 'org-1',
        conversationId: 'conv-1',
        authorUserId: 'user-1',
        content: 'hi',
        clientMessageId: 'cmid-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(crypto.encrypt).not.toHaveBeenCalled();
  });

  it('fast-path дедуп: findUnique нашёл → existing, deduped:true, транзакции нет, enqueue НЕ вызван', async () => {
    const existing = makeRow({ content: 'gcm:v1:hello', seq: 7n });
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    const outbox = makeOutboxQueue();
    const service = new MessageService(prisma, crypto, makeCfg(), outbox);

    const res = await service.sendMessage({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'hello',
      clientMessageId: 'cmid-1',
    });

    expect(res.deduped).toBe(true);
    expect(res.message.seq).toBe('7');
    expect(res.message.content).toBe('hello');
    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('enqueue после commit: новое сообщение → outboxQueue.enqueue(messageId) ровно один раз', async () => {
    const tx = makeTx(0n, (data) => makeRow({ id: 'msg-new', seq: 1n, content: (data as { content: string }).content }));
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const outbox = makeOutboxQueue();
    const service = new MessageService(prisma, crypto, makeCfg(), outbox);

    await service.sendMessage({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'hi',
      clientMessageId: 'cmid-1',
    });

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith('msg-new');
  });

  it('encryption at-rest: encrypt на content перед create, в data уходит шифр, в DTO — открытый текст', async () => {
    let captured: Record<string, unknown> | undefined;
    const tx = makeTx(0n, (data) => {
      captured = data as Record<string, unknown>;
      return makeRow({ seq: 1n, content: (data as { content: string }).content });
    });
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const res = await service.sendMessage({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'secret',
      clientMessageId: 'cmid-1',
    });

    expect(crypto.encrypt).toHaveBeenCalledWith('secret');
    expect(captured!.content).toBe('gcm:v1:secret');
    expect(crypto.decrypt).toHaveBeenCalledWith('gcm:v1:secret');
    expect(res.message.content).toBe('secret');
    expect(res.deduped).toBe(false);
  });

  it('seq gap-free: 100 последовательных отправок дают seq 1..100 без дыр', async () => {
    let current = 0n;
    const seqs: string[] = [];
    const service = new MessageService(
      {
        message: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn((cb: (t: unknown) => unknown) => {
          const tx = makeTx(current, (data) => {
            current = (data as { seq: bigint }).seq;
            return makeRow({ seq: current, content: (data as { content: string }).content });
          });
          return cb(tx);
        }),
      } as unknown as PrismaService,
      crypto,
      makeCfg(),
      makeOutboxQueue(),
    );

    for (let i = 0; i < 100; i++) {
      const res = await service.sendMessage({
        tenantId: 'org-1',
        conversationId: 'conv-1',
        authorUserId: 'user-1',
        content: `m${i}`,
        clientMessageId: `cmid-${i}`,
      });
      seqs.push(res.message.seq);
    }

    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => String(i + 1)));
  });

  it('P2002-гонка дедупа: create бросает P2002 → re-query existing, deduped:true', async () => {
    const existing = makeRow({ seq: 3n, content: 'gcm:v1:raced' });
    const tx = makeTx(2n, () => {
      throw makeP2002();
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const prisma = {
      message: { findUnique },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const res = await service.sendMessage({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'raced',
      clientMessageId: 'cmid-1',
    });

    expect(res.deduped).toBe(true);
    expect(res.message.seq).toBe('3');
    expect(res.message.content).toBe('raced');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('access по умолчанию normal; internal/external пробрасываются в create', async () => {
    const captures: string[] = [];
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => {
        const tx = makeTx(0n, (data) => {
          captures.push((data as { access: string }).access);
          return makeRow({ access: (data as { access: string }).access });
        });
        return cb(tx);
      }),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const base = {
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'x',
    };
    await service.sendMessage({ ...base, clientMessageId: 'a' });
    await service.sendMessage({ ...base, clientMessageId: 'b', access: 'internal' });
    await service.sendMessage({ ...base, clientMessageId: 'c', access: 'external' });

    expect(captures).toEqual(['normal', 'internal', 'external']);
  });

  it('seq в DTO — string, не BigInt', async () => {
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) =>
        cb(makeTx(41n, () => makeRow({ seq: 42n }))),
      ),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const res = await service.sendMessage({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'x',
      clientMessageId: 'cmid-1',
    });

    expect(typeof res.message.seq).toBe('string');
    expect(res.message.seq).toBe('42');
  });
});

describe('MessageService.toggleReaction', () => {
  function makeReactionPrisma(initialReactions: Record<string, string[]> | null) {
    let stored = initialReactions;
    const update = vi.fn((args: { data: { reactions: unknown } }) => {
      const r = args.data.reactions;
      stored = r === null || (typeof r === 'object' && r !== null && Object.getPrototypeOf(r) === null)
        ? null
        : (r as Record<string, string[]>);
      return Promise.resolve({});
    });
    const queryRaw = vi.fn(() => Promise.resolve([{ id: 'msg-1', reactions: stored }]));
    const tx = { $queryRaw: queryRaw, message: { update } };
    const prisma = {
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { prisma, update, get stored() { return stored; } };
  }

  it('первый вызов добавляет userId; повторный убирает (idempotent toggle)', async () => {
    const harness = makeReactionPrisma(null);
    const service = new MessageService(harness.prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    const first = await service.toggleReaction({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'user-1',
      emoji: '👍',
    });
    expect(first.reactions).toEqual({ '👍': ['user-1'] });

    const second = await service.toggleReaction({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'user-1',
      emoji: '👍',
    });
    expect(second.reactions).toEqual({});
  });

  it('другой userId добавляется к существующей реакции, не затирая', async () => {
    const harness = makeReactionPrisma({ '👍': ['user-1'] });
    const service = new MessageService(harness.prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    const res = await service.toggleReaction({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'user-2',
      emoji: '👍',
    });
    expect(res.reactions).toEqual({ '👍': ['user-1', 'user-2'] });
  });
});

describe('MessageService.getMessages', () => {
  it('decrypt content, seq→string, фильтр deletedAt, nextSeq = последний', async () => {
    const rows = [
      makeRow({ id: 'm1', seq: 5n, content: 'gcm:v1:a' }),
      makeRow({ id: 'm2', seq: 6n, content: 'gcm:v1:b' }),
    ];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = { message: { findMany } } as unknown as PrismaService;
    const service = new MessageService(prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    const res = await service.getMessages({ conversationId: 'conv-1', sinceSeq: '4' });

    expect(res.items.map((m) => m.seq)).toEqual(['5', '6']);
    expect(res.items.map((m) => m.content)).toEqual(['a', 'b']);
    expect(res.nextSeq).toBe('6');
    const whereArg = findMany.mock.calls[0]![0].where;
    expect(whereArg.deletedAt).toBeNull();
    expect(whereArg.seq).toEqual({ gt: 4n });
  });

  it('пусто → nextSeq null', async () => {
    const prisma = {
      message: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new MessageService(prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    const res = await service.getMessages({ conversationId: 'conv-1' });
    expect(res.items).toEqual([]);
    expect(res.nextSeq).toBeNull();
  });
});

describe('MessageService.insertHistorical', () => {
  let crypto: ReturnType<typeof makeCrypto>;

  beforeEach(() => {
    crypto = makeCrypto();
  });

  it('seq назначается, content зашифрован, outbox НЕ создаётся, custom createdAt сохранён', async () => {
    let captured: Record<string, unknown> | undefined;
    const createdAt = new Date('2025-01-02T03:04:05.000Z');
    const tx = makeTx(4n, (data) => {
      captured = data as Record<string, unknown>;
      return makeRow({
        id: 'msg-hist',
        seq: 5n,
        content: (data as { content: string }).content,
        createdAt,
      });
    });
    const outbox = makeOutboxQueue();
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), outbox);

    const res = await service.insertHistorical({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'historic',
      createdAt,
      clientMessageId: 'ic:comment-1',
    });

    expect(res.deduped).toBe(false);
    expect(res.messageId).toBe('msg-hist');
    expect(crypto.encrypt).toHaveBeenCalledWith('historic');
    expect(captured!.content).toBe('gcm:v1:historic');
    expect(captured!.seq).toBe(5n);
    expect(captured!.createdAt).toBe(createdAt);
    expect(tx.messageOutbox.create).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('dedup по clientMessageId: повтор → deduped:true, без новой строки', async () => {
    const existing = makeRow({ id: 'msg-existing' });
    const tx = makeTx(0n, () => makeRow());
    const prisma = {
      message: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const res = await service.insertHistorical({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'historic',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      clientMessageId: 'ic:comment-1',
    });

    expect(res.deduped).toBe(true);
    expect(res.messageId).toBe('msg-existing');
    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('P2002-гонка: create бросает P2002 → re-query existing, deduped:true', async () => {
    const existing = makeRow({ id: 'msg-raced' });
    const tx = makeTx(0n, () => {
      throw makeP2002();
    });
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    const prisma = {
      message: { findUnique },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    const res = await service.insertHistorical({
      tenantId: 'org-1',
      conversationId: 'conv-1',
      authorUserId: 'user-1',
      content: 'historic',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      clientMessageId: 'ic:comment-1',
    });

    expect(res.deduped).toBe(true);
    expect(res.messageId).toBe('msg-raced');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('MessageService.editMessage', () => {
  it('чужой автор → ForbiddenException, update НЕ вызван', async () => {
    const update = vi.fn();
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({ authorUserId: 'other' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MessageService(prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    await expect(
      service.editMessage({ messageId: 'm1', userId: 'user-1', content: 'new' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('свой автор → content re-encrypt, editedAt выставлен', async () => {
    const crypto = makeCrypto();
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({ authorUserId: 'user-1' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MessageService(prisma, crypto, makeCfg(), makeOutboxQueue());

    await service.editMessage({ messageId: 'm1', userId: 'user-1', content: 'edited' });

    expect(crypto.encrypt).toHaveBeenCalledWith('edited');
    const data = update.mock.calls[0]![0].data;
    expect(data.content).toBe('gcm:v1:edited');
    expect(data.editedAt).toBeInstanceOf(Date);
  });
});

describe('MessageService.softDeleteMessage', () => {
  it('чужой автор → ForbiddenException', async () => {
    const update = vi.fn();
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({ authorUserId: 'other' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MessageService(prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    await expect(
      service.softDeleteMessage({ messageId: 'm1', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('свой автор → deletedAt выставлен', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({ authorUserId: 'user-1' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MessageService(prisma, makeCrypto(), makeCfg(), makeOutboxQueue());

    await service.softDeleteMessage({ messageId: 'm1', userId: 'user-1' });

    const data = update.mock.calls[0]![0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});
