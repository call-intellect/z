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

/**
 * System-промпт посуточного rollup'а (пересмотр 2026-06-17): ОДИН LLM-вызов на
 * закрытие сессии-суток — `накопительное + сообщения дня → { daySummary,
 * rollingSummary }`. Плейн-текст + `validate` надёжнее strict-json_schema на
 * anthropic (см. llm-router gotchas). Тот же контракт, что у BitrixIngestService.
 */
const DAY_ROLLUP_SYSTEM_PROMPT = [
  'Ты — аналитик клиентских диалогов.',
  'Тебе дают НАКОПИТЕЛЬНОЕ САММАРИ переписки (контекст прошлых дней, может быть пустым)',
  'и СООБЩЕНИЯ ЗА ОДИН ДЕНЬ.',
  'Верни СТРОГО валидный JSON без markdown и пояснений, ровно с двумя строковыми полями:',
  '{"daySummary": "...", "rollingSummary": "..."}',
  '- daySummary — что произошло в этот день: суть запроса клиента, ключевые',
  '  решения, договорённости, открытые вопросы. 3-6 предложений, по-русски.',
  '- rollingSummary — ОБНОВЛЁННОЕ накопительное саммари всей переписки: объедини',
  '  прошлый контекст с событиями дня, убери устаревшее, держи компактным',
  '  (до ~10 предложений), по-русски. Если накопительного нет — построй с нуля.',
].join(' ');

/** Результат посуточного rollup'а. */
export interface ChatboxDayRollup {
  daySummary: string;
  rollingSummary: string;
}

/** Снять markdown-ограждение (```json … ```), если модель его добавила. */
function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Безопасный парс JSON-ответа rollup'а; null при любой кривизне. */
export function parseChatboxDayRollup(text: string): ChatboxDayRollup | null {
  try {
    const obj = JSON.parse(stripCodeFence(text)) as unknown;
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>;
      const { daySummary, rollingSummary } = rec;
      if (typeof daySummary === 'string' && typeof rollingSummary === 'string') {
        return {
          daySummary: daySummary.trim(),
          rollingSummary: rollingSummary.trim(),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

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
   * Посуточный rollup закрытой сессии (пересмотр 2026-06-17): ОДИН LLM-вызов
   * (`накопительное (ChatboxChat.rollingSummary) + сообщения дня → { daySummary,
   * rollingSummary }`). Персистит обновлённое `rollingSummary` (+`rollingSummaryAt`)
   * на чат; `daySummary` ВОЗВРАЩАЕТ (worker кладёт его в `ChatboxChatSession.summary`).
   * Best-effort: при любой ошибке LLM/парса → warn + null (мост не падает).
   *
   * Имя `generateSummary` сохранено для обратной совместимости с воркером.
   */
  async generateSummary(
    tenantId: string,
    sessionId: string,
  ): Promise<string | null> {
    const session = await this.prisma.chatboxChatSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true, chatId: true },
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

    // Накопительное саммари переписки (контекст прошлых дней) — на чате.
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: session.chatId, tenantId },
      select: { id: true, rollingSummary: true },
    });

    const transcript = renderTranscript(msgs);
    const prevRolling = chat?.rollingSummary?.trim() || '(пусто)';
    const variableInput = [
      'НАКОПИТЕЛЬНОЕ САММАРИ (прошлые дни):',
      prevRolling,
      '',
      'СООБЩЕНИЯ ЗА ДЕНЬ:',
      transcript,
    ].join('\n');

    // Анти-инъекция: транскрипт чата — сырые внешние сообщения (клиент/менеджер),
    // классический вектор prompt-injection. Оборачиваем user в маркеры данных +
    // ноту в system (guards включены всегда — у сервиса нет TypedConfigService).
    const { system: guardedSystem, user: guardedUser } = applyInputGuards(
      DAY_ROLLUP_SYSTEM_PROMPT,
      variableInput,
      { injection: true },
    );

    let parsed: ChatboxDayRollup | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        const result = await this.llm.call({
          taskType: 'chatbox-summary',
          systemPrompt: guardedSystem,
          // Переменная часть — в конце, под prompt caching.
          userMessage: guardedUser,
          tenantId,
          dataClass: 'sensitive',
          maxTokens: 900,
          sourceRef: { type: 'chatbox_session', id: sessionId },
          validate: (t: string) => parseChatboxDayRollup(t) !== null,
        });
        parsed = parseChatboxDayRollup(result.text);
      } catch (err) {
        this.logger.warn(
          `generateSummary: LLM-ошибка session=${sessionId} tenant=${tenantId} attempt=${attempt}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        break;
      }
    }
    if (!parsed) return null;

    // Накопительное — на чат (день уйдёт в session.summary через worker).
    if (chat) {
      await this.prisma.chatboxChat.updateMany({
        where: { id: chat.id, tenantId },
        data: {
          rollingSummary: parsed.rollingSummary,
          rollingSummaryAt: new Date(),
        },
      });
    }
    return parsed.daySummary;
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
        rollingSummary: true,
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
      // Пересмотр 2026-06-17 — накопительное саммари переписки (контекст всех дней).
      rollingSummary: chat?.rollingSummary ?? null,
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
