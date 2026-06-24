import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { IngestService } from '../ingest/ingest.service';
import { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';

const SOURCE_TYPE = 'chatbox' as const;
const SOURCE_NAME = 'ChatBox' as const;

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

export interface ChatboxDayRollup {
  daySummary: string;
  rollingSummary: string;
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

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

export interface TranscriptMessage {
  senderType: string;
  senderName?: string | null;
  text?: string | null;
  contentType: string;
}

export function renderTranscript(msgs: TranscriptMessage[]): string {
  return msgs
    .map((m) => {
      const role = m.senderType === 'CLIENT' ? 'Клиент' : 'Менеджер';
      const name = m.senderName ? ` [${m.senderName}]` : '';
      const body =
        m.contentType !== 'TEXT' || !m.text || m.text.trim() === '' ? `[${m.contentType}]` : m.text;
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
    @Inject(EntityResolutionService) private readonly entityResolution: EntityResolutionService,
  ) {}

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

  async generateSummary(tenantId: string, sessionId: string): Promise<string | null> {
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

  async ingestSession(tenantId: string, sessionId: string): Promise<{ rawEventId: string } | null> {
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
        externalId: true,
        senderType: true,
        senderName: true,
        text: true,
        contentType: true,
        externalCreatedAt: true,
      },
    });

    let previousSessionSummary: string | null = null;
    if (session.previousSessionId) {
      const prev = await this.prisma.chatboxChatSession.findFirst({
        where: { id: session.previousSessionId, tenantId },
        select: { summary: true },
      });
      previousSessionSummary = prev?.summary ?? null;
    }

    let customer: {
      externalId: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      externalCrmId: string | null;
    } | null = null;
    if (chat?.customerExternalId) {
      const c = await this.prisma.chatboxCustomer.findUnique({
        where: {
          tenantId_externalId: {
            tenantId,
            externalId: chat.customerExternalId,
          },
        },
        select: {
          externalId: true,
          name: true,
          email: true,
          phone: true,
          externalCrmId: true,
        },
      });
      customer = c
        ? {
            externalId: c.externalId,
            name: c.name,
            email: c.email,
            phone: c.phone,
            externalCrmId: c.externalCrmId,
          }
        : null;
    }

    let customerEntityId: string | null = null;
    if (customer) {
      try {
        const resolved = await this.entityResolution.findOrCreateCustomerEntity({
          tenantId,
          name: customer.name?.trim() || customer.externalId,
          email: customer.email?.trim() || null,
          phone: customer.phone?.trim() || null,
          externalCrmId: customer.externalCrmId ?? null,
          source: 'chatbox',
        });
        customerEntityId = resolved.entity.id;
      } catch (err) {
        this.logger.warn(
          { tenantId, sessionId, err: err instanceof Error ? err.message : String(err) },
          'ingestSession: не удалось резолвить Customer-сущность — продолжаем без неё',
        );
      }
    }

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

    const transcriptTurns = messages.map((m, i) => ({
      speaker:
        m.senderType === 'CLIENT'
          ? `Клиент${m.senderName ? ` [${m.senderName}]` : ''}`
          : `Менеджер${m.senderName ? ` [${m.senderName}]` : ''}`,
      text: m.text ?? '',
      startSec: i,
      endSec: i + 0.9,
      speakerParticipantId: null,
      authorPersonId: m.senderType === 'CLIENT' ? null : (responsible?.personId ?? null),
      messageExternalId: m.externalId,
    }));

    const payload = {
      kind: 'chatbox_chat_session' as const,
      chatExternalId: chat?.externalId ?? null,
      sessionId: session.id,
      sessionSeq: session.seq,
      channelType: chat?.channelType ?? null,
      customer: customer ? { ...customer, entityId: customerEntityId } : null,
      responsible,
      previousSessionSummary,
      rollingSummary: chat?.rollingSummary ?? null,
      messages: messages.map((m) => ({
        at: m.externalCreatedAt.toISOString(),
        from: m.senderType === 'CLIENT' ? 'client' : 'manager',
        name: m.senderName ?? null,
        text: m.text ?? null,
      })),
      fullText,
      transcript: { turns: transcriptTurns },
    };

    const source = await this.upsertSource(tenantId);

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
