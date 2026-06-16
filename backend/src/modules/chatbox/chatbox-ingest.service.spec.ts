import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { IngestService } from '../ingest/ingest.service';

import {
  ChatboxIngestService,
  renderTranscript,
} from './chatbox-ingest.service';

/**
 * Детерминированные unit-тесты ChatboxIngestService: Prisma / IngestService /
 * LlmRouterService полностью замоканы, БД/сети/LLM нет.
 *
 * Проверяем:
 *  - renderTranscript: роли (Клиент/Менеджер), не-TEXT → [<contentType>].
 *  - generateSummary (посуточный rollup, 2026-06-17): JSON {daySummary,
 *    rollingSummary} → возвращает daySummary + персистит rollingSummary на чат;
 *    ошибка LLM/битый JSON → null (best-effort).
 *  - ingestSession: открытая сессия → null (ingest НЕ вызван); закрытая →
 *    ingest.ingest вызван с dataClass='sensitive', sourceExternalId=sessionId,
 *    payload содержит fullText + kind; сессия обновлена rawEventId.
 *  - upsertSource: source отсутствует → create(type='chatbox').
 */

function makeService(over: {
  prisma?: Partial<Record<string, unknown>>;
  ingest?: Partial<IngestService>;
  llm?: Partial<LlmRouterService>;
} = {}): {
  service: ChatboxIngestService;
  prisma: any;
  ingest: any;
  llm: any;
} {
  const prisma = {
    source: { findUnique: vi.fn(), create: vi.fn() },
    chatboxChatSession: { findFirst: vi.fn(), update: vi.fn() },
    chatboxMessage: { findMany: vi.fn() },
    chatboxChat: { findFirst: vi.fn(), updateMany: vi.fn() },
    chatboxCustomer: { findUnique: vi.fn() },
    chatboxMember: { findUnique: vi.fn() },
    ...over.prisma,
  };
  const ingest = { ingest: vi.fn(), ...over.ingest };
  const llm = { call: vi.fn(), ...over.llm };
  const service = new ChatboxIngestService(
    prisma as unknown as PrismaService,
    ingest as unknown as IngestService,
    llm as unknown as LlmRouterService,
  );
  return { service, prisma, ingest, llm };
}

describe('renderTranscript', () => {
  it('клиент + менеджер → строки с «Клиент:» / «Менеджер:»', () => {
    const out = renderTranscript([
      { senderType: 'CLIENT', senderName: 'Arsenii', text: 'Привет', contentType: 'TEXT' },
      { senderType: 'USER', senderName: 'Никита', text: 'Здравствуйте', contentType: 'TEXT' },
      { senderType: 'ASSISTANT', senderName: null, text: 'Бот', contentType: 'TEXT' },
    ]);
    expect(out).toContain('Клиент [Arsenii]: Привет');
    expect(out).toContain('Менеджер [Никита]: Здравствуйте');
    expect(out).toContain('Менеджер: Бот');
  });

  it('не-TEXT без текста → [IMAGE]', () => {
    const out = renderTranscript([
      { senderType: 'CLIENT', senderName: 'A', text: null, contentType: 'IMAGE' },
    ]);
    expect(out).toBe('Клиент [A]: [IMAGE]');
  });
});

describe('ChatboxIngestService.generateSummary', () => {
  it('llm.call резолвит JSON → вернул daySummary + персист rollingSummary на чат', async () => {
    const { service, prisma, llm } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({ id: 's1', chatId: 'c1' });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      { senderType: 'CLIENT', senderName: 'A', text: 'вопрос', contentType: 'TEXT' },
    ]);
    prisma.chatboxChat.findFirst.mockResolvedValue({ id: 'c1', rollingSummary: null });
    llm.call.mockResolvedValue({
      text: '{"daySummary": "  итог дня  ", "rollingSummary": "накопительное"}',
    });

    const out = await service.generateSummary('t1', 's1');

    expect(out).toBe('итог дня');
    expect(llm.call).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'chatbox-summary',
        tenantId: 't1',
        dataClass: 'sensitive',
        maxTokens: 900,
        validate: expect.any(Function),
      }),
    );
    // Накопительное саммари записано на чат.
    expect(prisma.chatboxChat.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', tenantId: 't1' },
        data: expect.objectContaining({ rollingSummary: 'накопительное' }),
      }),
    );
  });

  it('битый JSON (не валидный rollup) → null, rollingSummary не пишется', async () => {
    const { service, prisma, llm } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({ id: 's1', chatId: 'c1' });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      { senderType: 'CLIENT', senderName: 'A', text: 'вопрос', contentType: 'TEXT' },
    ]);
    prisma.chatboxChat.findFirst.mockResolvedValue({ id: 'c1', rollingSummary: null });
    llm.call.mockResolvedValue({ text: 'просто текст, не json' });

    const out = await service.generateSummary('t1', 's1');

    expect(out).toBeNull();
    expect(prisma.chatboxChat.updateMany).not.toHaveBeenCalled();
  });

  it('llm.call бросает → вернул null (best-effort, не роняем)', async () => {
    const { service, prisma, llm } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({ id: 's1', chatId: 'c1' });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      { senderType: 'CLIENT', senderName: 'A', text: 'вопрос', contentType: 'TEXT' },
    ]);
    prisma.chatboxChat.findFirst.mockResolvedValue({ id: 'c1', rollingSummary: null });
    llm.call.mockRejectedValue(new Error('LLM down'));

    const out = await service.generateSummary('t1', 's1');

    expect(out).toBeNull();
  });
});

describe('ChatboxIngestService.ingestSession', () => {
  it('открытая сессия (endedAt=null) → null, ingest НЕ вызван', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({
      id: 's1',
      chatId: 'c1',
      seq: 1,
      endedAt: null,
      previousSessionId: null,
    });

    const out = await service.ingestSession('t1', 's1');

    expect(out).toBeNull();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('закрытая сессия → ingest вызван с sensitive/sessionId/fullText/kind; сессия обновлена', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({
      id: 's1',
      chatId: 'c1',
      seq: 2,
      startedAt: new Date('2026-06-04T12:00:00.000Z'),
      endedAt: new Date('2026-06-04T12:30:00.000Z'),
      previousSessionId: null,
    });
    prisma.chatboxChat.findFirst.mockResolvedValue({
      externalId: 'chatExt',
      channelType: 'TELEGRAM',
      customerExternalId: 'custExt',
      responsibleExternalId: 'memExt',
    });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      {
        senderType: 'CLIENT',
        senderName: 'Arsenii',
        text: 'Привет',
        contentType: 'TEXT',
        externalCreatedAt: new Date('2026-06-04T12:23:00.000Z'),
      },
      {
        senderType: 'USER',
        senderName: 'Никита',
        text: 'Здравствуйте',
        contentType: 'TEXT',
        externalCreatedAt: new Date('2026-06-04T12:28:00.000Z'),
      },
    ]);
    prisma.chatboxCustomer.findUnique.mockResolvedValue({
      externalId: 'custExt',
      name: 'Arsenii',
    });
    prisma.chatboxMember.findUnique.mockResolvedValue({
      externalId: 'memExt',
      name: 'Никита',
      linkedPersonId: 'p1',
    });
    prisma.source.findUnique.mockResolvedValue({ id: 'src1' });
    ingest.ingest.mockResolvedValue({ rawEvent: { id: 're1' }, idempotent: false });

    const out = await service.ingestSession('t1', 's1');

    expect(out).toEqual({ rawEventId: 're1' });
    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        sourceId: 'src1',
        sourceExternalId: 's1',
        dataClass: 'sensitive',
        // стабильный occurredAt = startedAt (не endedAt) — idempotencyKey не
        // должен меняться при дозаполнении сессии (иначе дубль RawEvent)
        occurredAt: new Date('2026-06-04T12:00:00.000Z'),
        payload: expect.objectContaining({
          kind: 'chatbox_chat_session',
          fullText: expect.stringContaining('Клиент [Arsenii]: Привет'),
        }),
      }),
    );
    expect(prisma.chatboxChatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: { rawEventId: 're1' },
      }),
    );
  });

  it('per-message сегментация: turn клиента authorPersonId=null, менеджера = responsible.personId; fullText сохранён', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({
      id: 's1',
      chatId: 'c1',
      seq: 3,
      startedAt: new Date('2026-06-04T12:00:00.000Z'),
      endedAt: new Date('2026-06-04T12:30:00.000Z'),
      previousSessionId: null,
    });
    prisma.chatboxChat.findFirst.mockResolvedValue({
      externalId: 'chatExt',
      channelType: 'TELEGRAM',
      customerExternalId: 'custExt',
      responsibleExternalId: 'memExt',
    });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      {
        senderType: 'CLIENT',
        senderName: 'Arsenii',
        text: 'У меня вопрос по цене',
        contentType: 'TEXT',
        externalCreatedAt: new Date('2026-06-04T12:23:00.000Z'),
      },
      {
        senderType: 'USER',
        senderName: 'Никита',
        text: 'Скидку дам, если оплатите сегодня',
        contentType: 'TEXT',
        externalCreatedAt: new Date('2026-06-04T12:28:00.000Z'),
      },
    ]);
    prisma.chatboxCustomer.findUnique.mockResolvedValue({
      externalId: 'custExt',
      name: 'Arsenii',
    });
    prisma.chatboxMember.findUnique.mockResolvedValue({
      externalId: 'memExt',
      name: 'Никита',
      linkedPersonId: 'p-manager',
    });
    prisma.source.findUnique.mockResolvedValue({ id: 'src1' });
    ingest.ingest.mockResolvedValue({ rawEvent: { id: 're1' }, idempotent: false });

    await service.ingestSession('t1', 's1');

    const payload = (ingest.ingest.mock.calls[0]![0] as { payload: any }).payload;
    expect(payload.transcript.turns).toHaveLength(2);
    // turn клиента — authorPersonId=null (не сотрудник)
    expect(payload.transcript.turns[0]).toMatchObject({
      speaker: 'Клиент [Arsenii]',
      text: 'У меня вопрос по цене',
      startSec: 0,
      authorPersonId: null,
    });
    // turn менеджера — authorPersonId = responsible.personId
    expect(payload.transcript.turns[1]).toMatchObject({
      speaker: 'Менеджер [Никита]',
      text: 'Скидку дам, если оплатите сегодня',
      startSec: 1,
      authorPersonId: 'p-manager',
    });
    // fullText (back-compat) сохранён
    expect(payload.fullText).toContain('Клиент [Arsenii]: У меня вопрос по цене');
    expect(payload.fullText).toContain('Менеджер [Никита]: Скидку дам');
  });
});

describe('ChatboxIngestService.upsertSource (через ingestSession)', () => {
  it('source отсутствует → create с type=chatbox', async () => {
    const { service, prisma, ingest } = makeService();
    prisma.chatboxChatSession.findFirst.mockResolvedValue({
      id: 's1',
      chatId: 'c1',
      seq: 1,
      startedAt: new Date('2026-06-04T12:00:00.000Z'),
      endedAt: new Date('2026-06-04T12:30:00.000Z'),
      previousSessionId: null,
    });
    prisma.chatboxChat.findFirst.mockResolvedValue({
      externalId: 'chatExt',
      channelType: 'TELEGRAM',
      customerExternalId: null,
      responsibleExternalId: null,
    });
    prisma.chatboxMessage.findMany.mockResolvedValue([
      {
        senderType: 'CLIENT',
        senderName: 'A',
        text: 'hi',
        contentType: 'TEXT',
        externalCreatedAt: new Date('2026-06-04T12:23:00.000Z'),
      },
    ]);
    prisma.source.findUnique.mockResolvedValue(null);
    prisma.source.create.mockResolvedValue({ id: 'srcNew' });
    ingest.ingest.mockResolvedValue({ rawEvent: { id: 're1' }, idempotent: false });

    await service.ingestSession('t1', 's1');

    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          type: 'chatbox',
          name: 'ChatBox',
          dataClass: 'sensitive',
        }),
      }),
    );
  });
});
