import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChatV2Conversation,
  type ChatV2Mode,
  type ChatV2Scope,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnswerCacheService } from '../dialog-layer/services/answer-cache.service';
import { DialogService } from '../dialog-layer/services/dialog.service';
import { narrowToChatIntent } from '../dialog-layer/services/query-classifier.service';

import type { ChatV2Stage } from '../knowledge-core/services/chat-v2.service';

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
  /**
   * §4 Ф1 (2026-06-11) — опциональный колбэк прогресса для SSE-стриминга.
   * Дефолт undefined = текущее поведение (синхронный `/messages` его не
   * передаёт). Эмитит 'understanding' в начале ask (до dialog-классификации),
   * затем пробрасывается через SynthesisService в knowledge-core ChatV2Service,
   * который эмитит 'searching' и 'writing'. При AnswerCache-HIT (быстрый путь)
   * стадии searching/writing не сработают — это нормально.
   */
  onStage?: (stage: ChatV2Stage) => void;
}

export interface ChatAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: unknown[];
  uncertaintyNote: string | null;
  mode: ChatV2Mode;
  /**
   * SBA α-5 dialog-layer — true, если ответ найден в AnswerCache (без
   * вызова retrieval+LLM). UI может показать subtle badge «кэш».
   */
  cacheHit: boolean;
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
    @Inject(DialogService) private readonly dialog: DialogService,
    @Inject(AnswerCacheService)
    private readonly answerCache: AnswerCacheService,
  ) {}

  async ask(input: AskInput): Promise<ChatAnswer> {
    // §4 Ф1 (2026-06-11) — стадия «Понимаю вопрос»: эмитим в самом начале,
    // ДО dialog-классификации. Колбэк опционален и не должен бросать.
    try {
      input.onStage?.('understanding');
    } catch {
      /* колбэк прогресса не критичен — не ломаем ask */
    }

    const mode: ChatV2Mode = input.mode ?? this.cfg.chatV2.defaultMode;
    const scope: ChatV2Scope = input.scope ?? 'org';
    const scopeRefId = input.scopeRefId ?? null;

    // SBA α-5 dialog-layer — парсим temporal queries.
    const validAtDate = input.asOf ? new Date(input.asOf) : null;
    const validAt =
      validAtDate && !Number.isNaN(validAtDate.getTime()) ? validAtDate : null;
    if (input.asOf && !validAt) {
      this.logger.warn(
        { asOf: input.asOf },
        'ChatV2OrchestrationService.ask: невалидный asOf, игнор → now()',
      );
    }
    const validAtIso = validAt ? validAt.toISOString() : null;

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

    // SBA α-5 dialog-layer — препроцессор (Contextualizer / Confidence /
    // Classifier / MultiQuery + AnswerCache lookup). На feature-flag OFF
    // вернёт no-op результат (см. DialogService.process).
    const dialogResult = await this.dialog.process({
      tenantId: input.tenantId,
      userId: input.userId,
      userMessage: input.question,
      conversationId: conversation.id,
      scope,
      scopeRefId,
      validAt: validAtIso,
    });

    // 2. Append user message (после dialog-layer'а, чтобы текущий вопрос
    // не попал в history контекстуализатора как «уже был»).
    await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: input.question,
    });

    const startedAt = Date.now();

    // 3. AnswerCache HIT — пропускаем retrieval + LLM, сразу пишем ответ
    // в БД и возвращаем.
    if (dialogResult.cachedAnswer) {
      const cached = dialogResult.cachedAnswer;
      const assistantMessage = await this.conversations.appendMessage({
        conversationId: conversation.id,
        role: 'assistant',
        mode,
        text: cached.text,
        citations:
          cached.citations.length > 0
            ? (cached.citations as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        retrievalMeta: {
          usedBlockIds: cached.usedBlockIds,
          fromCache: true,
        } as Prisma.InputJsonValue,
        llmMeta: { fromCache: true } as Prisma.InputJsonValue,
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
      this.metrics.observeChatV2RetrievalBlocks({
        mode,
        count: cached.usedBlockIds.length,
      });
      if (isFirstUserMessage) {
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
        text: cached.text,
        citations: cached.citations,
        uncertaintyNote: cached.uncertaintyNote,
        mode,
        cacheHit: true,
      };
    }

    // 4. Загрузить history + summary для systemPrompt.
    const history = await this.loadHistory(
      conversation.id,
      this.cfg.chatV2.historyMessages,
    );
    const convSummary = await this.loadConversationSummary(conversation.id);

    // 5. Synthesize — передаём standalone/queries/validAt/intent/summary
    // из dialog-layer'а. SynthesisService применит mode-prompt и
    // RetrievalCache.
    const result = await this.synthesis.synthesize({
      tenantId: input.tenantId,
      userId: input.userId,
      question: input.question,
      mode,
      scope,
      scopeRefId,
      history,
      standaloneQuestion: dialogResult.standaloneQuestion,
      queries: dialogResult.queries,
      validAt,
      structuralFilters: dialogResult.structuralFilters ?? null,
      conversationSummary: convSummary,
      // ТЗ 2026-05-29 Phase 1 — сужение DialogIntent (7 категорий) до
      // ChatDialogIntent (4 категории) для chat-v2 synthesis. Новые
      // intent'ы (daily_plan_morning/evening/note) перехватываются в
      // bot-adapter раньше и сюда не доходят; для безопасности маппим
      // их в 'factual'.
      intent: narrowToChatIntent(dialogResult.intent),
      // §4 Ф1 (2026-06-11) — проброс колбэка стадий прогресса (SSE) до
      // knowledge-core ChatV2Service (стадии 'searching'/'writing').
      onStage: input.onStage,
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

    // 6. Append assistant message.
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

    // 7. Сохраняем ответ в AnswerCache (если dialog-layer enabled
    // и ответ не пустой).
    if (dialogResult.enabled && result.text.length > 0) {
      void this.answerCache
        .set(
          {
            tenantId: input.tenantId,
            userId: input.userId,
            standaloneQuestion: dialogResult.standaloneQuestion,
            scope,
            scopeRefId,
            validAt: validAtIso,
          },
          {
            text: result.text,
            citations: result.citations,
            uncertaintyNote: result.uncertaintyNote,
            mode,
            usedBlockIds,
            cachedAt: new Date().toISOString(),
          },
        )
        .catch((err) => {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'AnswerCache.set promise rejected (handled inside)',
          );
        });
    }

    // 8. Сгенерировать title после первого ответного раунда.
    if (isFirstUserMessage) {
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
      cacheHit: false,
    };
  }

  private async loadConversationSummary(
    conversationId: string,
  ): Promise<string | null> {
    const c = await this.prisma.chatV2Conversation.findUnique({
      where: { id: conversationId },
      select: { summary: true },
    });
    return c?.summary ?? null;
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
