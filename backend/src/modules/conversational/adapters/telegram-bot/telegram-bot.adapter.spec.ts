import type { Channel, ChannelBinding } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { AccountsService } from '../../../accounts/accounts.service';
import type { VoxService } from '../../../ai/services/vox.service';
import type { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import type { DocumentsService } from '../../../documents/documents.service';
import type { ChannelRegistry } from '../../channel-registry';
import type { ConversationalLinkCodeService } from '../../link-code.service';


import type { TelegramApiClient } from './telegram-api-client';
import type { TelegramBotMessageHandler } from './telegram-bot-message.handler';
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

function makeChannel(opts: { global?: boolean } = {}): Channel {
  return {
    id: opts.global ? 'global-channel' : 'channel-1',
    // β-9: глобальный канал имеет tenantId=null.
    tenantId: opts.global ? null : 'org-1',
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
  classifyIntent?:
    | 'factual'
    | 'exploratory'
    | 'analytical'
    | 'clone_roleplay'
    | 'daily_plan_morning'
    | 'daily_report_evening'
    | 'note'
    | 'task'
    | 'show_tasks';
  classifyConfidence?: number;
  withTaskHandler?: boolean;
  classifyThrows?: boolean;
  rateLimitCount?: number;
  // β-9 / Phase 6 — если undefined, AccountsService инжектится как @Optional
  // отсутствующий → /login деградирует с сообщением «временно недоступно».
  // Если задан, эмулирует прод-сборку.
  accountsRequestThrows?: boolean;
  withAccounts?: boolean;
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
    // β-9: резолв tenantId из Membership при глобальном канале.
    membership: {
      findFirst: vi.fn().mockResolvedValue({ orgId: 'org-1' }),
    },
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
    // β-9: метрики «незнакомый отправитель».
    incTelegramBotUnknownSender: vi.fn(),
    // β-9 / Phase 6: метрика команды `/login` в боте.
    incBotLoginCommand: vi.fn(),
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
          confidence: opts.classifyConfidence ?? null,
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

  const accounts = (opts.withAccounts || opts.accountsRequestThrows
    ? {
        requestMagicLinkForBot: opts.accountsRequestThrows
          ? vi.fn().mockRejectedValue(new Error('user u-42 не найден'))
          : vi.fn().mockResolvedValue({
              url: 'https://z.app/accounts/magic-link/consume?token=raw-token-123',
              ttlMinutes: 15,
            }),
      }
    : undefined) as AccountsService | undefined;

  const taskHandler = (
    opts.withTaskHandler
      ? {
          tryHandleStructural: vi.fn().mockResolvedValue(false),
          handleCreateTask: vi.fn().mockResolvedValue(undefined),
          handleShowTasks: vi.fn().mockResolvedValue(undefined),
        }
      : undefined
  ) as unknown as TelegramBotMessageHandler | undefined;

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
    taskHandler,
    accounts,
  );
  return {
    adapter,
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
    taskHandler,
    accounts,
  };
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

  // ─────────── §2 гейт намерения: task / show_tasks ───────────

  it('текст task (conf>=0.7): task-handler создаёт задачу, InboundMessage не возвращается', async () => {
    mocks = makeAdapter({
      classifyIntent: 'task',
      classifyConfidence: 0.9,
      withTaskHandler: true,
    });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    const update: TelegramUpdate = {
      update_id: 50,
      message: {
        message_id: 50,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Поставь задачу: подготовить КП к пятнице',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(vi.mocked(mocks.taskHandler!.handleCreateTask)).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        text: 'Поставь задачу: подготовить КП к пятнице',
      }),
    );
    expect(vi.mocked(mocks.taskHandler!.handleShowTasks)).not.toHaveBeenCalled();
  });

  it('текст show_tasks (conf>=0.7): читалка «мои задачи», InboundMessage не возвращается', async () => {
    mocks = makeAdapter({
      classifyIntent: 'show_tasks',
      classifyConfidence: 0.9,
      withTaskHandler: true,
    });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    const update: TelegramUpdate = {
      update_id: 51,
      message: {
        message_id: 51,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Какие у меня задачи?',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(vi.mocked(mocks.taskHandler!.handleShowTasks)).toHaveBeenCalled();
    expect(vi.mocked(mocks.taskHandler!.handleCreateTask)).not.toHaveBeenCalled();
  });

  it('текст show_tasks с conf<0.7: трактуется как вопрос (chat_query), не читалка', async () => {
    mocks = makeAdapter({
      classifyIntent: 'show_tasks',
      classifyConfidence: 0.5,
      withTaskHandler: true,
    });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    const update: TelegramUpdate = {
      update_id: 52,
      message: {
        message_id: 52,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'задачи',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toMatchObject({ type: 'chat_query' });
    expect(vi.mocked(mocks.taskHandler!.handleShowTasks)).not.toHaveBeenCalled();
  });

  it('текст task с conf<0.7: падает в free_note (не создаёт задачу)', async () => {
    mocks = makeAdapter({
      classifyIntent: 'task',
      classifyConfidence: 0.5,
      withTaskHandler: true,
    });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    const update: TelegramUpdate = {
      update_id: 53,
      message: {
        message_id: 53,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'надо бы что-то сделать наверное',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toMatchObject({ type: 'free_note' });
    expect(vi.mocked(mocks.taskHandler!.handleCreateTask)).not.toHaveBeenCalled();
  });

  it('структурный спецслучай (tryHandleStructural=true): адаптер выходит, classify не зовётся', async () => {
    mocks = makeAdapter({ withTaskHandler: true });
    vi.mocked(mocks.taskHandler!.tryHandleStructural).mockResolvedValue(true);
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    const update: TelegramUpdate = {
      update_id: 54,
      message: {
        message_id: 54,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'принял',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel,
    });
    expect(result).toBeNull();
    expect(vi.mocked(mocks.classifier.classify)).not.toHaveBeenCalled();
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
    // β-9: метрика «незнакомый отправитель / no_binding».
    expect(
      vi.mocked(mocks.metrics.incTelegramBotUnknownSender),
    ).toHaveBeenCalledWith({ reason: 'no_binding' });
  });
});

// ───────────────────────────── β-9: глобальный канал ─────────────────────

describe('TelegramBotChannelAdapter.ingestUpdate (β-9 глобальный канал)', () => {
  it('свободный текст: резолвит tenantId через Membership.findFirst по userId', async () => {
    const mocks = makeAdapter({ classifyIntent: 'factual' });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    vi.mocked(mocks.prisma.membership.findFirst).mockResolvedValue({
      orgId: 'org-resolved-via-membership',
    } as never);

    const update: TelegramUpdate = {
      update_id: 100,
      message: {
        message_id: 30,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Какой план продаж на сентябрь?',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      // β-9: tenantId не передаётся — резолвится из binding.
      channel,
    });
    expect(result).toEqual({
      type: 'chat_query',
      userId: 'user-42',
      tenantId: 'org-resolved-via-membership',
      question: 'Какой план продаж на сентябрь?',
      originChannelBindingId: 'binding-1',
    });
    expect(mocks.prisma.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-42' } }),
    );
  });

  it('если binding есть, но Membership нет — отвечает «не привязаны к компании» + метрика no_membership', async () => {
    const mocks = makeAdapter();
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );
    vi.mocked(mocks.prisma.membership.findFirst).mockResolvedValue(null);

    const update: TelegramUpdate = {
      update_id: 101,
      message: {
        message_id: 31,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: 'Что-то спрашиваю',
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      channel,
    });
    expect(result).toBeNull();
    expect(
      vi.mocked(mocks.metrics.incTelegramBotUnknownSender),
    ).toHaveBeenCalledWith({ reason: 'no_membership' });
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/не привязаны к компании|руководителя|приглашени/i);
  });

  // ─── /login (β-9 / Phase 6) ─────────────────────────────────────────

  it('/login: verified binding + AccountsService → magic-link отправляется в чат + metric ok', async () => {
    const mocks = makeAdapter({ withAccounts: true });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 200,
      message: {
        message_id: 50,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login',
      },
    };
    const result = await mocks.adapter.ingestUpdate({ update, channel });

    expect(result).toBeNull();
    expect(mocks.accounts!.requestMagicLinkForBot).toHaveBeenCalledWith({
      userId: 'user-42',
    });
    expect(mocks.api.sendMessage).toHaveBeenCalled();
    const sentText = vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text;
    expect(sentText).toMatch(/15 минут/);
    expect(sentText).toContain(
      'https://z.app/accounts/magic-link/consume?token=raw-token-123',
    );
    // Метрика ok пишется внутри AccountsService.requestMagicLinkForBot —
    // у адаптера остаётся только incBotInbound для трекинга трафика.
    expect(mocks.metrics.incBotInbound).toHaveBeenCalledWith({
      channel: 'telegram_bot',
      kind: 'other',
    });
  });

  it('/login@kora_bot: суффикс username тоже распознаётся как команда', async () => {
    const mocks = makeAdapter({ withAccounts: true });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 201,
      message: {
        message_id: 51,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login@kora_bot',
      },
    };
    await mocks.adapter.ingestUpdate({ update, channel });

    expect(mocks.accounts!.requestMagicLinkForBot).toHaveBeenCalled();
  });

  it('/login от незалинкованного юзера → reply «привяжите бот» + metric not_linked', async () => {
    const mocks = makeAdapter({ withAccounts: true });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(null);

    const update: TelegramUpdate = {
      update_id: 202,
      message: {
        message_id: 52,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login',
      },
    };
    const result = await mocks.adapter.ingestUpdate({ update, channel });

    expect(result).toBeNull();
    expect(mocks.accounts!.requestMagicLinkForBot).not.toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/привяжите бот|ссылке от руководителя/i);
    expect(
      vi.mocked(mocks.metrics.incBotLoginCommand),
    ).toHaveBeenCalledWith({ outcome: 'not_linked' });
  });

  it('/login с binding но без verifiedAt → reply «привяжите бот» + metric not_linked', async () => {
    const mocks = makeAdapter({ withAccounts: true });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue({
      ...verifiedBinding(),
      verifiedAt: null,
    } as never);

    const update: TelegramUpdate = {
      update_id: 203,
      message: {
        message_id: 53,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login',
      },
    };
    await mocks.adapter.ingestUpdate({ update, channel });

    expect(mocks.accounts!.requestMagicLinkForBot).not.toHaveBeenCalled();
    expect(
      vi.mocked(mocks.metrics.incBotLoginCommand),
    ).toHaveBeenCalledWith({ outcome: 'not_linked' });
  });

  it('/login: AccountsService.requestMagicLinkForBot бросает → reply «не удалось» (graceful)', async () => {
    const mocks = makeAdapter({ accountsRequestThrows: true });
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.prisma.channelBinding.findFirst).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 204,
      message: {
        message_id: 54,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login',
      },
    };
    const result = await mocks.adapter.ingestUpdate({ update, channel });

    expect(result).toBeNull();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/Не удалось выпустить ссылку|перепривязать|поддержку/i);
  });

  it('/login: AccountsService отсутствует в DI (legacy) → reply «временно недоступно», не падаем', async () => {
    // По умолчанию makeAdapter без withAccounts/accountsRequestThrows
    // не передаёт accounts, эмулируя старую DI-сборку.
    const mocks = makeAdapter();
    const channel = makeChannel({ global: true });

    const update: TelegramUpdate = {
      update_id: 205,
      message: {
        message_id: 55,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/login',
      },
    };
    const result = await mocks.adapter.ingestUpdate({ update, channel });

    expect(result).toBeNull();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toMatch(/временно недоступна/i);
  });

  it('/start <code> на глобальном канале — линковка работает без tenantId', async () => {
    const mocks = makeAdapter();
    const channel = makeChannel({ global: true });
    vi.mocked(mocks.linkCode.consume).mockResolvedValue('user-42');
    vi.mocked(mocks.prisma.channelBinding.upsert).mockResolvedValue(
      verifiedBinding(),
    );

    const update: TelegramUpdate = {
      update_id: 102,
      message: {
        message_id: 32,
        date: 1700000000,
        chat: { id: 100 },
        from: { id: 100 },
        text: '/start ABCDEF123456',
      },
    };
    const result = await mocks.adapter.ingestUpdate({ update, channel });
    expect(result).toBeNull();
    expect(mocks.linkCode.consume).toHaveBeenCalledWith({
      kind: 'telegram_bot',
      code: 'ABCDEF123456',
    });
    expect(mocks.prisma.channelBinding.upsert).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.api.sendMessage).mock.calls[0]![0].text,
    ).toContain('привязан');
  });
});

describe('TelegramBotChannelAdapter.renderText — meeting.invite (Фаза 3.3)', () => {
  it('рендерит человекочитаемый текст с названием, хостом и ссылкой (не default-ветка)', () => {
    const { adapter } = makeAdapter();
    // renderText private — обращаемся через cast (мини-e2e шаблона).
    const text = (
      adapter as unknown as {
        renderText: (n: {
          eventType: string;
          payload: Record<string, unknown>;
        }) => string;
      }
    ).renderText({
      eventType: 'meeting.invite',
      payload: {
        joinUrl: 'https://app.kora.test/m/m-1?inv=tok123',
        meetingTitle: 'Планёрка',
        hostName: 'Сергей',
      },
    });
    expect(text).toContain('Приглашение на встречу');
    expect(text).toContain('Сергей');
    expect(text).toContain('Планёрка');
    expect(text).toContain('https://app.kora.test/m/m-1?inv=tok123');
    // НЕ ушло в generic-fallback default-ветки.
    expect(text).not.toBe('Уведомление: meeting.invite');
  });

  it('не падает на пустом payload (graceful)', () => {
    const { adapter } = makeAdapter();
    const text = (
      adapter as unknown as {
        renderText: (n: {
          eventType: string;
          payload: Record<string, unknown>;
        }) => string;
      }
    ).renderText({ eventType: 'meeting.invite', payload: {} });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('TelegramBotChannelAdapter.renderText — видимые брифы (Ф2 assistant-channels)', () => {
  const render = (
    eventType: string,
    payload: Record<string, unknown>,
  ): string => {
    const { adapter } = makeAdapter();
    return (
      adapter as unknown as {
        renderText: (n: {
          eventType: string;
          payload: Record<string, unknown>;
        }) => string;
      }
    ).renderText({ eventType, payload });
  };

  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    [
      'checkin.prompt',
      {
        kind: 'checkin',
        checkInKind: 'morning',
        personId: 'p-1',
        dateLocal: '2026-06-12',
        question: 'Какие 1-3 задачи у вас в фокусе сегодня?',
      },
      [
        'Какие 1-3 задачи у вас в фокусе сегодня?',
        'Ответьте текстом или голосом — Кора запишет.',
      ],
    ],
    [
      'operations.weekly_digest',
      {
        digestId: 'd-1',
        weekStart: '2026-06-08',
        weekEnd: '2026-06-14',
        title: 'Итоги недели',
        body: 'Закрыто 12 задач, 3 риска требуют внимания.',
        actionUrl: 'https://app.kora.test/digest/d-1',
      },
      [
        'Итоги недели',
        'Закрыто 12 задач',
        'https://app.kora.test/digest/d-1',
      ],
    ],
    [
      'goals.pulse',
      {
        digestId: 'd-2',
        isoWeek: '2026-W24',
        title: 'Пульс целей',
        body: 'Цель «Выручка» — 80% к плану.',
        actionUrl: 'https://app.kora.test/goals',
      },
      ['Пульс целей', 'Выручка', 'https://app.kora.test/goals'],
    ],
    [
      'operations.monthly_recap',
      {
        snapshotId: 's-1',
        periodYm: '2026-05',
        title: 'Итоги мая',
        body: 'Главное за месяц: запуск брифов.',
        actionUrl: 'https://app.kora.test/recap',
      },
      ['Итоги мая', 'запуск брифов'],
    ],
    [
      'proactive.notification',
      {
        proactiveNotificationId: 'pn-1',
        ruleType: 'stale_goal',
        severity: 'warning',
        title: 'Цель без движения',
        body: 'Цель «Найм» не обновлялась 14 дней.',
      },
      ['Цель без движения', 'Найм'],
    ],
    [
      'event.reminder',
      {
        eventId: 'e-1',
        eventTitle: 'Планёрка отдела',
        startAtIso: '2026-06-12T09:30:00.000Z',
        offsetMin: 15,
        location: 'Переговорка 2',
        actionUrl: 'https://app.kora.test/calendar',
      },
      ['Планёрка отдела', '09:30 12.06', '(UTC)', 'Переговорка 2'],
    ],
    [
      'issue.mention',
      {
        issueId: 'i-1',
        commentId: 'c-1',
        byUserId: 'u-1',
        snippet: 'Посмотри, пожалуйста, оценку по этой задаче',
        issueIdentifier: 'KOR-42',
      },
      ['Вас упомянули в задаче', 'KOR-42', 'Посмотри, пожалуйста, оценку'],
    ],
    [
      'idea.status_changed',
      {
        ideaId: 'id-1',
        statement: 'Перейти на единый стек',
        oldStatus: 'captured',
        newStatus: 'shipped',
        reason: 'внедрено в спринте',
      },
      [
        'Идея сменила статус',
        'Перейти на единый стек',
        'captured',
        'shipped',
        'внедрено в спринте',
      ],
    ],
    [
      'support.ticket_created',
      {
        ticketId: 't-1',
        ticketNumber: '124',
        subject: 'Не открывается отчёт',
        actionUrl: 'https://app.kora.test/support/124',
      },
      ['Обращение №124', 'Не открывается отчёт'],
    ],
    [
      'support.ticket_reply',
      {
        ticketId: 't-1',
        ticketNumber: '124',
        subject: 'Не открывается отчёт',
        snippet: 'Мы починили, проверьте ещё раз',
        actionUrl: 'https://app.kora.test/support/124',
      },
      ['Ответ по обращению №124', 'Мы починили, проверьте ещё раз'],
    ],
  ];

  it.each(cases)(
    '%s — человекочитаемый бриф, не «Уведомление: …»',
    (eventType, payload, expectedParts) => {
      const text = render(eventType, payload);
      for (const part of expectedParts) {
        expect(text).toContain(part);
      }
      expect(text.startsWith('Уведомление:')).toBe(false);
    },
  );

  it('note.ack — возвращает payload.text как есть', () => {
    const text = render('note.ack', { text: 'Записал: договорённость с подрядчиком.' });
    expect(text).toBe('Записал: договорённость с подрядчиком.');
    expect(text.startsWith('Уведомление:')).toBe(false);
  });

  it('note.ack — fallback при пустом text', () => {
    const text = render('note.ack', { text: '' });
    expect(text).toBe('Записал в память Коры 🧠');
  });

  it('неизвестный eventType без title/body — прежний default-fallback', () => {
    const text = render('foo.bar', {});
    expect(text.startsWith('Уведомление:')).toBe(true);
    expect(text).toContain('foo.bar');
  });

  it('HTML-экранирование: <script> в title рендерится как &lt;script&gt;', () => {
    const text = render('operations.weekly_digest', {
      title: '<script>alert(1)</script>',
      body: 'тело дайджеста',
    });
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });
});
