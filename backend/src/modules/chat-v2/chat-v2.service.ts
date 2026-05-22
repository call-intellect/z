import {
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import {
  type ChatV2Conversation,
  type ChatV2Mode,
  type ChatV2Scope,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatV2ConversationsService } from './services/conversations.service';
import { SynthesisService } from './services/synthesis.service';

/**
 * SBA α-5 — ChatV2OrchestrationService (главный сервис нового модуля).
 *
 * Принимает question + опц. conversationId + mode + scope + scopeRefId,
 * управляет conversation (create если нужно), вызывает SynthesisService,
 * сохраняет user/assistant сообщения, генерирует title после первого
 * ответного раунда.
 *
 * Это новый модуль `chat-v2/`. Legacy `chat/` (модуль) использует ChatV2Service
 * напрямую через flag `CHAT_V2_ENABLED` — не трогается, помечен @deprecated.
 */

export interface AskInput {
  tenantId: string;
  userId: string;
  question: string;
  conversationId?: string;
  mode?: ChatV2Mode;
  scope?: ChatV2Scope;
  scopeRefId?: string | null;
  /** ISO date — temporal queries. На α-5 → 501 если задан. */
  asOf?: string;
  /**
   * Канал, через который пришёл вопрос (для record-keeping в новом
   * conversation и для outbound reply через ConversationalService).
   */
  channelKindOrigin?: string | null;
}

export interface ChatAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: unknown[];
  uncertaintyNote: string | null;
  mode: ChatV2Mode;
}

@Injectable()
export class ChatV2OrchestrationService {
  private readonly logger = new Logger(ChatV2OrchestrationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ChatV2ConversationsService)
    private readonly conversations: ChatV2ConversationsService,
    @Inject(SynthesisService) private readonly synthesis: SynthesisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async ask(input: AskInput): Promise<ChatAnswer> {
    if (input.asOf) {
      throw new NotImplementedException({
        ok: false,
        error: {
          code: 'temporal_not_implemented',
          message:
            'Temporal queries (asOf) будут реализованы после α-4 evolving — на α-5 не поддерживаются',
        },
      });
    }

    const mode: ChatV2Mode = input.mode ?? this.cfg.chatV2.defaultMode;
    const scope: ChatV2Scope = input.scope ?? 'org';
    const scopeRefId = input.scopeRefId ?? null;

    // 1. Получить или создать conversation.
    let conversation: ChatV2Conversation;
    let isFirstUserMessage = false;
    if (input.conversationId) {
      conversation = await this.conversations.getById({
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId: input.conversationId,
      });
    } else {
      conversation = await this.conversations.create({
        tenantId: input.tenantId,
        userId: input.userId,
        scope,
        scopeRefId,
        channelKindOrigin: input.channelKindOrigin ?? null,
      });
      isFirstUserMessage = true;
    }

    // 2. Append user message.
    await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: input.question,
    });

    // 3. Загрузить history (последние N сообщений ДО ответа).
    const history = await this.loadHistory(
      conversation.id,
      this.cfg.chatV2.historyMessages,
    );

    const startedAt = Date.now();

    // 4. Synthesize.
    const result = await this.synthesis.synthesize({
      tenantId: input.tenantId,
      userId: input.userId,
      question: input.question,
      mode,
      scope,
      scopeRefId,
      history,
    });

    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.observeChatV2SynthesisDuration({
      mode,
      seconds: durationSeconds,
    });
    this.metrics.incChatV2Query({
      mode,
      channelOrigin:
        conversation.channelKindOrigin ?? input.channelKindOrigin ?? 'web',
    });
    const usedBlockIds =
      (result.retrievalMeta?.usedBlockIds as string[] | undefined) ?? [];
    this.metrics.observeChatV2RetrievalBlocks({
      mode,
      count: usedBlockIds.length,
    });
    if (result.citations.length === 0) {
      this.metrics.incChatV2NoEvidence({ mode });
    }
    if (result.uncertaintyNote) {
      this.metrics.incChatV2UncertaintyMarked({ mode });
    }

    // 5. Append assistant message.
    const assistantMessage = await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      mode,
      text: result.text,
      citations:
        result.citations.length > 0
          ? (result.citations as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      retrievalMeta: result.retrievalMeta as Prisma.InputJsonValue,
      llmMeta: result.llmMeta as Prisma.InputJsonValue,
    });

    // 6. Сгенерировать title после первого ответного раунда.
    if (isFirstUserMessage) {
      // fire-and-forget — title не должен блокировать ответ. Ошибки
      // ловятся внутри generateTitle.
      void this.conversations
        .generateTitle({
          tenantId: input.tenantId,
          conversationId: conversation.id,
          firstUserMessage: input.question,
        })
        .catch((err) => {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'generateTitle promise rejected (handled inside)',
          );
        });
    }

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      text: result.text,
      citations: result.citations,
      uncertaintyNote: result.uncertaintyNote,
      mode,
    };
  }

  /**
   * Загрузить N последних сообщений диалога в формате, пригодном для
   * подмешивания в systemPrompt (см. ChatV2Service.history).
   * Возвращает сообщения по возрастанию createdAt (старое → новое).
   * Текущий user-message уже добавлен в БД до этого вызова, поэтому
   * он войдёт в history как «последний» — это ОК (knowledge-core
   * ChatV2Service сам обрежет последние 6 и подмешает их в prompt).
   */
  private async loadHistory(
    conversationId: string,
    limit: number,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (limit <= 0) return [];
    const items = await this.prisma.chatV2Message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { role: true, text: true },
    });
    return items
      .reverse()
      .map((m) => ({ role: m.role, content: m.text }));
  }
}
