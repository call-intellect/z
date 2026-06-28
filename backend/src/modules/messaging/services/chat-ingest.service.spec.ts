import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IngestService } from '../../ingest/ingest.service';

import { ChatIngestService } from './chat-ingest.service';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    tenantId: 'org-1',
    conversationId: 'conv-1',
    authorUserId: 'author-1',
    authorType: 'human',
    content: 'gcm:v1:привет команда',
    voiceTranscript: null,
    deletedAt: null,
    createdAt: new Date('2026-06-28T10:00:00.000Z'),
    ...overrides,
  };
}

function build(opts: {
  message?: Record<string, unknown> | null;
  feedsGraph?: boolean;
  ingestEnabled?: boolean;
}) {
  const messageRow = opts.message === null ? null : makeMessage(opts.message ?? {});
  const ingestFn = vi.fn().mockResolvedValue({ rawEvent: { id: 'raw-1' }, idempotent: false });
  const upsertFn = vi.fn().mockResolvedValue({ id: 'src-1' });

  const prisma = {
    message: { findUnique: vi.fn().mockResolvedValue(messageRow) },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ feedsGraph: opts.feedsGraph ?? true }),
    },
    source: { upsert: upsertFn },
  } as unknown as PrismaService;

  const ingest = { ingest: ingestFn } as unknown as IngestService;
  const crypto = {
    decrypt: vi.fn((v: string) => v.replace(/^gcm:v1:/, '')),
  } as unknown as CryptoService;
  const cfg = { chat: { ingestEnabled: opts.ingestEnabled ?? true } } as unknown as TypedConfigService;

  const service = new ChatIngestService(prisma, ingest, crypto, cfg);
  return { service, ingestFn, upsertFn };
}

describe('ChatIngestService.ingestMessage', () => {
  it('feedsGraph=true → ingest с kind=chat_message и sourceExternalId=msg:<id>', async () => {
    const { service, ingestFn } = build({ feedsGraph: true });

    await service.ingestMessage('msg-1');

    expect(ingestFn).toHaveBeenCalledTimes(1);
    const arg = ingestFn.mock.calls[0]![0];
    expect(arg.tenantId).toBe('org-1');
    expect(arg.sourceExternalId).toBe('msg:msg-1');
    expect(arg.dataClass).toBe('internal');
    expect(arg.payload.kind).toBe('chat_message');
    expect(arg.payload.text).toBe('привет команда');
    expect(arg.payload.userId).toBe('author-1');
    expect(arg.payload.conversationId).toBe('conv-1');
    expect(arg.payload.messageId).toBe('msg-1');
  });

  it('feedsGraph=false → skip (ingest НЕ вызван)', async () => {
    const { service, ingestFn } = build({ feedsGraph: false });

    await service.ingestMessage('msg-1');

    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('authorType=system → skip', async () => {
    const { service, ingestFn } = build({ message: { authorType: 'system' } });

    await service.ingestMessage('msg-1');

    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('deletedAt → skip', async () => {
    const { service, ingestFn } = build({ message: { deletedAt: new Date() } });

    await service.ingestMessage('msg-1');

    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('CHAT_INGEST_ENABLED=false → skip', async () => {
    const { service, ingestFn } = build({ ingestEnabled: false });

    await service.ingestMessage('msg-1');

    expect(ingestFn).not.toHaveBeenCalled();
  });

  it('пустой content + есть voiceTranscript → text из транскрипта', async () => {
    const { service, ingestFn } = build({
      message: { content: 'gcm:v1:', voiceTranscript: 'это расшифровка голосового' },
    });

    await service.ingestMessage('msg-1');

    const arg = ingestFn.mock.calls[0]![0];
    expect(arg.payload.text).toBe('это расшифровка голосового');
  });

  it('идемпотентность: повтор → тот же sourceExternalId', async () => {
    const { service, ingestFn } = build({ feedsGraph: true });

    await service.ingestMessage('msg-1');
    await service.ingestMessage('msg-1');

    expect(ingestFn).toHaveBeenCalledTimes(2);
    expect(ingestFn.mock.calls[0]![0].sourceExternalId).toBe('msg:msg-1');
    expect(ingestFn.mock.calls[1]![0].sourceExternalId).toBe('msg:msg-1');
  });
});
