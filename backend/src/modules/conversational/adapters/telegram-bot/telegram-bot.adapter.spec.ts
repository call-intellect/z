import type { Channel, ChannelBinding } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { VoxService } from '../../../ai/services/vox.service';
import type { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import type { DocumentsService } from '../../../documents/documents.service';
import type { ChannelRegistry } from '../../channel-registry';
import type { ConversationalLinkCodeService } from '../../link-code.service';

import type { TelegramApiClient } from './telegram-api-client';
import { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import type { TelegramUpdate } from './telegram.types';

/**
 * Unit-тесты zero-button `TelegramBotChannelAdapter.ingestUpdate`
 * (SBA β-1 rip-out, 2026-05-23). Покрывают:
 *   - `/start <token>` deep-link (валидный/невалидный код),
 *   - голый код привязки регексом (12-hex),
 *   - voice → ASR → intent classify → free_note|chat_query,
 *   - document → DocumentsService.upload,
 *   - свободный текст с классификацией (chat_query vs free_note),
 *   - анти-spam voice rate-limit,
 *   - незалинкованный юзер.
 *
 * Все зависимости мокаются через `vi.fn()` и cast to type — паттерн,
 * принятый в проекте.
 */

function makeChannel(): Channel {
  return {
    id: 'channel-1',
    tenantId: 'org-1',
    kind: 'telegram_bot',
    direction: 'bidirectional',
    config: {
      botToken: 'plain-token',
      webhookSecret: 'secret',
      botUsername: 'kora_test_bot',
    },
    status: 'active',
    maxDataClass: 'internal',
    brokenReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Channel;
}

function makeAdapter(opts: {
  voiceEnabled?: boolean;
  documentEnabled?: boolean;
  intentClassifierEnabled?: boolean;
  classifyIntent?: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
  classifyThrows?: boolean;
  rateLimitCount?: number;
} = {}) {
  const registry = { register: vi.fn() } as unknown as ChannelRegistry;
  const prisma = {
    channelBinding: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    notification: { findUnique: vi.fn() },
    notificationDelivery: { findFirst: vi.fn() },
    channel: { findMany: vi.fn().mockResolvedValue([]) },
    person: { findFirst: vi.fn() },
  } as unknown as PrismaService;

  const incr = vi.fn().mockResolvedValue(opts.rateLimitCount ?? 1);
  const expire = vi.fn().mockResolvedValue(1);
  const redis = {
    client: { incr, expire },
  } as unknown as RedisService;

  const crypto = {
    isEncrypted: vi.fn().mockReturnValue(false),
    decrypt: vi.fn().mockImplementation((v: string) => v),
  } as unknown as CryptoService;

  const api = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 999, chatId: 100 }),
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    getFile: vi
      .fn()
      .mockResolvedValue({ file_id: 'f1', file_path: 'voice/file.ogg' }),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('audio-bytes')),
  } as unknown as TelegramApiClient;

  const linkCode = { consume: vi.fn() } as unknown as ConversationalLinkCodeService;

  const metrics = {
    incTelegramBotWebhookReceived: vi.fn(),
    incTelegramBotApiError: vi.fn(),
    incBotInbound: vi.fn(),
    observeBotVoiceAsrDuration: vi.fn(),
    incBotIntentClassified: vi.fn(),
  } as unknown as BusinessMetricsService;

  const vox = {
    submit: vi.fn().mockResolvedValue({ taskId: 't1' }),
    poll: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      transcriptText: 'Какой бюджет на четвёртый квартал?',
      durationSeconds: 5,
    }),
  } as unknown as VoxService;

  const documents = {
    upload: vi.fn().mockResolvedValue({ id: 'doc-1', status: 'uploaded' }),
  } as unknown as DocumentsService;

  const classifier = {
    classify: opts.classifyThrows
      ? vi.fn().mockRejectedValue(new Error('llm down'))
      : vi.fn().mockResolvedValue({
          intent: opts.classifyIntent ?? 'factual',
          source: 'llm',
          durationSeconds: 0.1,
        }),
  } as unknown as QueryClassifierService;

  const cfg = {
    bot: {
      voiceEnabled: opts.voiceEnabled ?? true,
      documentEnabled: opts.documentEnabled ?? true,
      intentClassifierEnabled: opts.intentClassifierEnabled ?? true,
    },
  } as unknown as TypedConfigService;

  const adapter = new TelegramBotChannelAdapter(
    registry,
    prisma,
    redis,
    crypto,
    api,
    linkCode,
    metrics,
    vox,
    documents,
    classifier,
    cfg,
  );
  return { adapter, registry, prisma, redis, crypto, api, linkCode, metrics, vox, documents, classifier };
}

const verifiedBinding = (id = 'binding-1'): ChannelBinding =>
  ({
    id,
    userId: 'user-42',
    channelId: 'channel-1',
    externalId: '100',
    verifiedAt: new Date(),
    preferences: {},
  }) as unknown as ChannelBinding;

describe('TelegramBotChannelAdapter.ingestUpdate (zero-button)', () => {
  let mocks: ReturnType<typeof makeAdapter>;
  let channel: Channel;

  beforeEach(() => {
    mocks = makeAdapter();
    channel = makeChannel();
  });

  // ─────────── /start <token> ───────────

  it('/start <token>: при валидном коде создаёт binding и шлёт приветствие', async () => {
    vi.mocked(mocks.linkCode.consume).mockResolvedValue('user-42');
    vi.mocked(mocks.prisma.channelBinding.upsert).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100, username: 'user' },
        text: '/start ABCDEF123456',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.linkCode.consume).toHaveBeenCalledWith({
      kind: 'telegram_bot',
      code: 'ABCDEF123456',
    });
    expect(mocks.prisma.channelBinding.upsert).toHaveBeenCalled();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toContain('привязан');
  });

  it('/start без аргумента: шлёт приветствие, binding не создаёт', async () => {
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 11,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/start',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.linkCode.consume).not.toHaveBeenCalled();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/Добро пожаловать|код|канал/i);
  });

  // ─────────── голый код привязки ───────────

  it('голый 12-hex код: для незалинкованного юзера прожигает код и создаёт binding', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(null);
    vi.mocked(mocks.linkCode.consume).mockResolvedValue('user-42');
    vi.mocked(mocks.prisma.channelBinding.upsert).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 12,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'a1b2c3d4e5f6',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.linkCode.consume).toHaveBeenCalledWith({
      kind: 'telegram_bot',
      code: 'a1b2c3d4e5f6',
    });
  });

  it('голый 6-digit код: для незалинкованного юзера тоже прожигает', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(null);
    vi.mocked(mocks.linkCode.consume).mockResolvedValue('user-42');
    vi.mocked(mocks.prisma.channelBinding.upsert).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 4,
      message: {
        message_id: 13,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '123456',
      },
    };
    await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(mocks.linkCode.consume).toHaveBeenCalledWith({
      kind: 'telegram_bot',
      code: '123456',
    });
  });

  // ─────────── свободный текст с классификацией ───────────

  it('свободный текст (factual через LLM): возвращает chat_query', async () => {
    mocks = makeAdapter({ classifyIntent: 'factual' });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 5,
      message: {
        message_id: 14,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Какой бюджет на Q4?',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toEqual({
      type: 'chat_query',
      userId: 'user-42',
      tenantId: 'org-1',
      question: 'Какой бюджет на Q4?',
      originChannelBindingId: 'binding-1',
    });
  });

  it('свободный текст (LLM throw → эвристика): возвращает free_note для утверждения', async () => {
    mocks = makeAdapter({ classifyThrows: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 6,
      message: {
        message_id: 15,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Просто заметка без знака вопроса',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toMatchObject({
      type: 'free_note',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'Просто заметка без знака вопроса',
      originChannelBindingId: 'binding-1',
    });
  });

  // ─────────── voice ───────────

  it('voice: getFile → ASR → classify → chat_query', async () => {
    mocks = makeAdapter({ classifyIntent: 'factual' });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 7,
      message: {
        message_id: 16,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        voice: { file_id: 'voice-file-id-1' },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(mocks.api.getFile).toHaveBeenCalledWith({
      token: 'plain-token',
      fileId: 'voice-file-id-1',
    });
    expect(mocks.vox.submit).toHaveBeenCalled();
    expect(mocks.vox.poll).toHaveBeenCalled();
    expect(result).toEqual({
      type: 'chat_query',
      userId: 'user-42',
      tenantId: 'org-1',
      question: 'Какой бюджет на четвёртый квартал?',
      originChannelBindingId: 'binding-1',
    });
  });

  it('voice: при rate-limit (>10 за час) — null + reply', async () => {
    mocks = makeAdapter({ rateLimitCount: 11 });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 8,
      message: {
        message_id: 17,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        voice: { file_id: 'voice-rl' },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.vox.submit).not.toHaveBeenCalled();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/много голосовых|позже/i);
  });

  it('voice: при BOT_VOICE_ENABLED=false — null + reply «недоступны»', async () => {
    mocks = makeAdapter({ voiceEnabled: false });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 9,
      message: {
        message_id: 18,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        voice: { file_id: 'voice-disabled' },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.vox.submit).not.toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/недоступны/i);
  });

  // ─────────── document ───────────

  it('document: getFile → DocumentsService.upload', async () => {
    mocks = makeAdapter();
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    vi.mocked(mocks.prisma.person.findFirst).mockResolvedValue({
      id: 'person-1',
    } as unknown as Awaited<
      ReturnType<typeof mocks.prisma.person.findFirst>
    >);

    const update: TelegramUpdate = {
      update_id: 10,
      message: {
        message_id: 19,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        document: {
          file_id: 'doc-file-id-1',
          file_name: 'plan.pdf',
          mime_type: 'application/pdf',
          file_size: 12_345,
        },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.api.getFile).toHaveBeenCalledWith({
      token: 'plain-token',
      fileId: 'doc-file-id-1',
    });
    expect(mocks.documents.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        uploaderPersonId: 'person-1',
        file: expect.objectContaining({
          originalName: 'plan.pdf',
          mimeType: 'application/pdf',
        }),
      }),
    );
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/принят/i);
  });

  it('document: больше 20 МБ — reply «слишком большой», upload не вызывается', async () => {
    mocks = makeAdapter();
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 11,
      message: {
        message_id: 20,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        document: {
          file_id: 'too-big',
          file_name: 'huge.pdf',
          mime_type: 'application/pdf',
          file_size: 25 * 1024 * 1024,
        },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.documents.upload).not.toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/слишком большой|20\s*МБ/i);
  });

  // ─────────── незалинкованный юзер ───────────

  it('текст от незалинкованного юзера (не похожий на код): возвращает null и шлёт «привяжите»', async () => {
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(null);

    const update: TelegramUpdate = {
      update_id: 12,
      message: {
        message_id: 21,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Привет, бот. Помоги.',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/Аккаунт не привязан|код|канал/i);
  });
});
