import type { Channel, ChannelBinding } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

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

import type { MaxApiClient } from './max-api-client';
import { MaxBotChannelAdapter } from './max-bot.adapter';
import type { MaxUpdate } from './max.types';

function makeChannel(): Channel {
  return {
    id: 'channel-max-1',
    tenantId: 'org-1',
    kind: 'max_bot',
    direction: 'bidirectional',
    config: {
      accessToken: 'plain-token',
      webhookSecret: 'secret',
      botName: 'kora_max_bot',
    },
    status: 'active',
    maxDataClass: 'internal',
    brokenReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Channel;
}

const verifiedBinding = (): ChannelBinding =>
  ({
    id: 'binding-max-1',
    userId: 'user-42',
    channelId: 'channel-max-1',
    externalId: '100',
    verifiedAt: new Date(),
    preferences: {},
  }) as unknown as ChannelBinding;

function makeAdapter(opts: {
  assistantChannelRoutingEnabled?: boolean;
  classifyIntent?: 'factual' | 'note' | 'probe_reply';
  classifyConfidence?: number;
  openProbe?: { id: string; payload: Record<string, unknown> } | null;
} = {}) {
  const registry = { register: vi.fn() } as unknown as ChannelRegistry;
  const prisma = {
    channelBinding: {
      findFirst: vi.fn().mockResolvedValue(verifiedBinding()),
      upsert: vi.fn(),
    },
    person: { findFirst: vi.fn() },
    notification: {
      findFirst: vi.fn().mockResolvedValue(opts.openProbe ?? null),
    },
  } as unknown as PrismaService;

  const redis = {
    client: {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    },
  } as unknown as RedisService;

  const crypto = {
    isEncrypted: vi.fn().mockReturnValue(false),
    decrypt: vi.fn().mockImplementation((v: string) => v),
  } as unknown as CryptoService;

  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message: { mid: 'mid-1' } }),
    downloadAttachment: vi.fn().mockResolvedValue(Buffer.from('audio-bytes')),
  } as unknown as MaxApiClient;

  const linkCode = {
    consume: vi.fn(),
  } as unknown as ConversationalLinkCodeService;

  const metrics = {
    incMaxBotWebhookReceived: vi.fn(),
    incBotInbound: vi.fn(),
    incBotIntentClassified: vi.fn(),
    observeBotVoiceAsrDuration: vi.fn(),
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
    upload: vi.fn(),
  } as unknown as DocumentsService;

  const classifier = {
    classify: vi.fn().mockResolvedValue({
      intent: opts.classifyIntent ?? 'factual',
      source: 'llm',
      confidence: opts.classifyConfidence ?? 0.9,
      durationSeconds: 0.1,
    }),
  } as unknown as QueryClassifierService;

  const cfg = {
    bot: {
      voiceEnabled: true,
      documentEnabled: true,
      intentClassifierEnabled: true,
      assistantChannelRoutingEnabled: opts.assistantChannelRoutingEnabled ?? false,
    },
    getDynamic: vi.fn().mockResolvedValue(0.6),
  } as unknown as TypedConfigService;

  const adapter = new MaxBotChannelAdapter(
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
  return { adapter, prisma, api, vox, classifier };
}

const textUpdate = (text: string): MaxUpdate => ({
  update_type: 'message_created',
  message: {
    sender: { user_id: 100 } as never,
    recipient: { chat_id: 200 } as never,
    body: { text },
  },
});

describe('MaxBotChannelAdapter.ingestUpdate (Ф5 assistant_turn routing)', () => {
  it('ON: свободный текст → assistant_turn (классификатор не вызывается)', async () => {
    const mocks = makeAdapter({ assistantChannelRoutingEnabled: true });

    const result = await mocks.adapter.ingestUpdate({
      update: textUpdate('Какой бюджет на Q4?'),
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect(result).toMatchObject({
      type: 'assistant_turn',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'Какой бюджет на Q4?',
      originChannelBindingId: 'binding-max-1',
    });
    expect(vi.mocked(mocks.classifier.classify)).not.toHaveBeenCalled();
  });

  it('ON: voice → Vox-транскрипт → assistant_turn', async () => {
    const mocks = makeAdapter({ assistantChannelRoutingEnabled: true });

    const update: MaxUpdate = {
      update_type: 'message_created',
      message: {
        sender: { user_id: 100 } as never,
        recipient: { chat_id: 200 } as never,
        body: {
          text: '',
          attachments: [{ type: 'voice', payload: { url: 'https://max.example/v1.ogg' } }],
        },
      },
    };
    const result = await mocks.adapter.ingestUpdate({
      update,
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect(mocks.vox.submit).toHaveBeenCalled();
    expect(result).toMatchObject({
      type: 'assistant_turn',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'Какой бюджет на четвёртый квартал?',
      metadata: expect.objectContaining({ source: 'max_bot', kind: 'voice' }),
      originChannelBindingId: 'binding-max-1',
    });
    expect(vi.mocked(mocks.classifier.classify)).not.toHaveBeenCalled();
  });

  it('OFF: свободный текст → classify → chat_query как раньше (бит-в-бит)', async () => {
    const mocks = makeAdapter({
      assistantChannelRoutingEnabled: false,
      classifyIntent: 'factual',
    });

    const result = await mocks.adapter.ingestUpdate({
      update: textUpdate('Какой бюджет на Q4?'),
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect(vi.mocked(mocks.classifier.classify)).toHaveBeenCalled();
    expect(result).toEqual({
      type: 'chat_query',
      userId: 'user-42',
      tenantId: 'org-1',
      question: 'Какой бюджет на Q4?',
      originChannelBindingId: 'binding-max-1',
    });
  });

  it('OFF: заметка (note) → free_note как раньше', async () => {
    const mocks = makeAdapter({
      assistantChannelRoutingEnabled: false,
      classifyIntent: 'note',
    });

    const result = await mocks.adapter.ingestUpdate({
      update: textUpdate('Договорились с подрядчиком о сроках'),
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect(result).toMatchObject({
      type: 'free_note',
      userId: 'user-42',
      tenantId: 'org-1',
      text: 'Договорились с подрядчиком о сроках',
    });
  });

  // ─── ТЗ 2026-06-17 probe-phase2 Ф1 — свободный ответ на probe в MAX ───
  it('есть pending probe + probe_reply(0.8) → type=response (приоритетнее assistant-routing ON)', async () => {
    const mocks = makeAdapter({
      assistantChannelRoutingEnabled: true,
      classifyIntent: 'probe_reply',
      classifyConfidence: 0.8,
      openProbe: {
        id: 'notif-probe-max-1',
        payload: { question: 'Кто отвечает за это решение?' },
      },
    });

    const result = await mocks.adapter.ingestUpdate({
      update: textUpdate('Иванов отвечает'),
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect(result).toEqual({
      type: 'response',
      userId: 'user-42',
      tenantId: 'org-1',
      notificationId: 'notif-probe-max-1',
      payload: { text: 'Иванов отвечает', kind: 'implicit_response' },
      originChannelBindingId: 'binding-max-1',
    });
    const classifyArg = vi.mocked(mocks.classifier.classify).mock
      .calls[0]?.[0] as { openProbeQuestion?: string };
    expect(classifyArg.openProbeQuestion).toBe('Кто отвечает за это решение?');
  });

  it('НЕТ pending probe → pre-фильтр не классифицирует, ON → assistant_turn', async () => {
    const mocks = makeAdapter({
      assistantChannelRoutingEnabled: true,
      openProbe: null,
    });

    const result = await mocks.adapter.ingestUpdate({
      update: textUpdate('Какой бюджет на Q4?'),
      tenantId: 'org-1',
      channel: makeChannel(),
    });

    expect((result as { type: string }).type).toBe('assistant_turn');
    // Без открытого probe pre-фильтр не вызывает классификатор (экономия).
    expect(vi.mocked(mocks.classifier.classify)).not.toHaveBeenCalled();
  });
});
