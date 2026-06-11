import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { IngestService } from '../ingest/ingest.service';

/**
 * ChatboxIngestService — мост ChatBox → knowledge-core (ТЗ
 * plans/tz/2026-06-05-chatbox-integration.md, Фаза 5).
 *
 * Закрытую сессию чата (`ChatboxChatSession.endedAt != null`) превращает в
 * один `RawEvent(sourceType='chatbox')` через `IngestService.ingest` —
 * дальше его подхватывает block-ingest worker knowledge-core (мы его не
 * трогаем). Payload содержит `fullText` (рендер транскрипта строкой),
 * иначе извлечение IdeaBlock было бы слабым.
 *
 * Дополнительно генерирует best-effort LLM-summary сессии (`llm-router`,
 * taskType `chatbox-summary`) — для подмешивания в анализ следующих сессий
 * и показа в вебе. При ошибке LLM summary = null (не роняем мост).
 *
 * Зависимости (все @Global, в imports модуля не нужны):
 *   - PrismaService (PrismaModule @Global).
 *   - IngestService (IngestModule @Global, exports IngestService).
 *   - LlmRouterService (AiModule @Global, exports LlmRouterService).
 */

const SOURCE_TYPE = 'chatbox' as const;
const SOURCE_NAME = 'ChatBox' as const;

const SUMMARY_SYSTEM_PROMPT =
  'Ты — аналитик клиентских диалогов. Сделай краткое саммари переписки: ' +
  'суть запроса клиента, ключевые решения, договорённости, открытые вопросы. ' +
  '3-6 предложений, по-русски.';

/** Минимальная форма сообщения для рендера транскрипта. */
export interface TranscriptMessage {
  senderType: string;
  senderName?: string | null;
  text?: string | null;
  contentType: string;
}

/**
 * Чистый рендер транскрипта сессии в строку (для unit-теста и payload).
 *
 * Формат строки на сообщение: `<роль> [<имя>]: <текст>`, где роль —
 * `Клиент` для `senderType==='CLIENT'`, иначе `Менеджер`
 * (USER/ASSISTANT/QUALITY_CONTROL). Для не-TEXT сообщений и пустого текста
 * подставляется `[<contentType>]`.
 */
export function renderTranscript(msgs: TranscriptMessage[]): string {
  return msgs
    .map((m) => {
      const role = m.senderType === 'CLIENT' ? 'Клиент' : 'Менеджер';
      const name = m.senderName ? ` [${m.senderName}]` : '';
      const body =
        m.contentType !== 'TEXT' || !m.text || m.text.trim() === ''
          ? `[${m.contentType}]`
          : m.text;
      return `${role}${name}: ${body}`;
    })
    .join('\n');
}

@Injectable()
export class ChatboxIngestService {
  private readonly logger = new Logger(ChatboxIngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /**
   * Lazy upsert `Source(type='chatbox', name='ChatBox')` для tenant'а.
   * Конкурентно-безопасен (try/catch на P2002 — повторный findUnique).
   */
  private async upsertSource(tenantId: string): Promise<{ id: string }> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: SOURCE_TYPE,
          name: SOURCE_NAME,
        },
      },
      select: { id: true },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: SOURCE_TYPE,
          name: SOURCE_NAME,
          dataClass: 'sensitive',
          isActive: true,
        },
        select: { id: true },
      });
    } catch (err) {
      // Гонка: между findUnique и create кто-то создал — повторим find.
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: SOURCE_TYPE,
            name: SOURCE_NAME,
          },
        },
        select: { id: true },
      });
      if (retry) return retry;
      throw err;
    }
  }

  /**
   * Best-effort LLM-summary сессии. При любой ошибке LLM → warn + null
   * (мост в knowledge-core не должен падать из-за саммари).
   */
  async generateSummary(
    tenantId: string,
    sessionId: string,
  ): Promise<string | null> {
    const session = await this.prisma.chatboxChatSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    });
    if (!session) return null;

    const msgs = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, sessionId },
      orderBy: { externalCreatedAt: 'asc' },
      select: {
        senderType: true,
        senderName: true,
        text: true,
        contentType: true,
      },
    });
    if (msgs.length === 0) return null;

    const transcript = renderTranscript(msgs);

    // Анти-инъекция: транскрипт чата — сырые внешние сообщения (клиент/менеджер),
    // классический вектор prompt-injection. Оборачиваем user в маркеры данных +
    // ноту в system. У сервиса нет TypedConfigService, поэтому глобальный
    // kill-switch (aiFeatures.promptInjectionGuardEnabled) тут НЕ гейтит —
    // guards включены всегда (enabled по умолчанию true).
    const { system: guardedSystem, user: guardedUser } = applyInputGuards(
      SUMMARY_SYSTEM_PROMPT,
      transcript,
      { injection: true },
    );

    try {
      const result = await this.llm.call({
        taskType: 'chatbox-summary',
        systemPrompt: guardedSystem,
        // Переменная часть (транскрипт) — в конце, под prompt caching.
        userMessage: guardedUser,
        tenantId,
        dataClass: 'sensitive',
        maxTokens: 500,
      });
      return result.text.trim();
    } catch (err) {
      this.logger.warn(
        `generateSummary: LLM-ошибка для session=${sessionId} tenant=${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Превращает закрытую сессию чата в `RawEvent(sourceType='chatbox')` через
   * `IngestService.ingest` (мост в knowledge-core). Анализируем только
   * закрытые сессии (`endedAt != null`) — открытая ещё копит сообщения.
   *
   * Идемпотентно: `sourceExternalId=sessionId` → стабильный idempotencyKey,
   * повторный вызов не плодит RawEvent.
   *
   * @returns `{ rawEventId }` или null (открытая/отсутствующая сессия).
   */
  async ingestSession(
    tenantId: string,
    sessionId: string,
  ): Promise<{ rawEventId: string } | null> {
    const session = await this.prisma.chatboxChatSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        id: true,
        chatId: true,
        seq: true,
        startedAt: true,
        endedAt: true,
        previousSessionId: true,
      },
    });
    // Анализируем только закрытые сессии — открытая (endedAt=null) ещё копит.
    if (!session || session.endedAt === null) return null;

    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: session.chatId, tenantId },
      select: {
        externalId: true,
        channelType: true,
        customerExternalId: true,
        responsibleExternalId: true,
      },
    });

    const messages = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, sessionId },
      orderBy: { externalCreatedAt: 'asc' },
      select: {
        senderType: true,
        senderName: true,
        text: true,
        contentType: true,
        externalCreatedAt: true,
      },
    });

    // Summary предыдущей сессии (для подмешивания в анализ).
    let previousSessionSummary: string | null = null;
    if (session.previousSessionId) {
      const prev = await this.prisma.chatboxChatSession.findFirst({
        where: { id: session.previousSessionId, tenantId },
        select: { summary: true },
      });
      previousSessionSummary = prev?.summary ?? null;
    }

    // Резолв клиента (unified Customer).
    let customer: { externalId: string; name: string | null } | null = null;
    if (chat?.customerExternalId) {
      const c = await this.prisma.chatboxCustomer.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: chat.customerExternalId,
          },
        },
        select: { externalId: true, name: true },
      });
      customer = c ? { externalId: c.externalId, name: c.name } : null;
    }

    // Резолв ответственного менеджера (+ связь с Person Коры).
    let responsible: {
      externalId: string;
      name: string | null;
      personId: string | null;
    } | null = null;
    if (chat?.responsibleExternalId) {
      const m = await this.prisma.chatboxMember.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: chat.responsibleExternalId,
          },
        },
        select: { externalId: true, name: true, linkedPersonId: true },
      });
      responsible = m
        ? { externalId: m.externalId, name: m.name, personId: m.linkedPersonId }
        : null;
    }

    const renderMsgs: TranscriptMessage[] = messages.map((m) => ({
      senderType: m.senderType,
      senderName: m.senderName,
      text: m.text,
      contentType: m.contentType,
    }));
    const fullText = renderTranscript(renderMsgs);

    // Per-message сегментация для корректной атрибуции subject по говорящему
    // (фикс cross-attribution chatbox). Менеджер-реплики → authorPersonId
    // ответственного; клиент-реплики → authorPersonId=null (не сотрудник).
    // Синтетические таймкоды (1 сообщение = 1 секунда) дают block-extraction
    // привязку evidenceStartMs к нужному сегменту.
    const transcriptTurns = messages.map((m, i) => ({
      speaker:
        m.senderType === 'CLIENT'
          ? `Клиент${m.senderName ? ` [${m.senderName}]` : ''}`
          : `Менеджер${m.senderName ? ` [${m.senderName}]` : ''}`,
      text: m.text ?? '',
      startSec: i,
      endSec: i + 0.9,
      speakerParticipantId: null,
      authorPersonId:
        m.senderType === 'CLIENT' ? null : (responsible?.personId ?? null),
    }));

    const payload = {
      kind: 'chatbox_chat_session' as const,
      chatExternalId: chat?.externalId ?? null,
      sessionId: session.id,
      sessionSeq: session.seq,
      channelType: chat?.channelType ?? null,
      customer,
      responsible,
      previousSessionSummary,
      messages: messages.map((m) => ({
        at: m.externalCreatedAt.toISOString(),
        from: m.senderType === 'CLIENT' ? 'client' : 'manager',
        name: m.senderName ?? null,
        text: m.text ?? null,
      })),
      // Обязательно для block-ingest worker (generic-путь ищет fullText).
      fullText,
      // Per-message turns (фикс cross-attribution): buildSegments идёт по
      // meeting-пути и строит сегмент на сообщение с authorPersonId.
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);

    // стабильный occurredAt = startedAt: idempotencyKey не должен меняться при
    // дозаполнении сессии (иначе дубль RawEvent)
    const occurredAt = session.startedAt;

    const res = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: sessionId,
      occurredAt,
      payload,
      dataClass: 'sensitive',
    });

    await this.prisma.chatboxChatSession.update({
      where: { id: session.id },
      data: { rawEventId: res.rawEvent.id },
    });

    return { rawEventId: res.rawEvent.id };
  }
}
