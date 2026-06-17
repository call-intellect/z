import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChatV2Conversation,
  type ChatV2Mode,
  type ChatV2Scope,
  type DataClass,
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

export interface AskInput {
  tenantId: string;
  userId: string;
  question: string;
  conversationId?: string;
  mode?: ChatV2Mode;
  scope?: ChatV2Scope;
  scopeRefId?: string | null;
  asOf?: string;
  channelKindOrigin?: string | null;
  onStage?: (stage: ChatV2Stage) => void;
}

export interface ChatAnswer {
  conversationId: string;
  messageId: string;
  text: string;
  citations: unknown[];
  uncertaintyNote: string | null;
  mode: ChatV2Mode;
  cacheHit: boolean;
  dataClass: DataClass;
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
    try {
      input.onStage?.('understanding');
    } catch {}

    const mode: ChatV2Mode = input.mode ?? this.cfg.chatV2.defaultMode;
    const scope: ChatV2Scope = input.scope ?? 'org';
    const scopeRefId = input.scopeRefId ?? null;

    const validAtDate = input.asOf ? new Date(input.asOf) : null;
    const validAt = validAtDate && !Number.isNaN(validAtDate.getTime()) ? validAtDate : null;
    if (input.asOf && !validAt) {
      this.logger.warn(
        { asOf: input.asOf },
        'ChatV2OrchestrationService.ask: невалидный asOf, игнор → now()',
      );
    }
    const validAtIso = validAt ? validAt.toISOString() : null;

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

    const dialogResult = await this.dialog.process({
      tenantId: input.tenantId,
      userId: input.userId,
      userMessage: input.question,
      conversationId: conversation.id,
      scope,
      scopeRefId,
      validAt: validAtIso,
    });

    await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      text: input.question,
    });

    const startedAt = Date.now();

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
        channelOrigin: conversation.channelKindOrigin ?? input.channelKindOrigin ?? 'web',
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
        dataClass: coerceDataClass(cached.dataClass),
      };
    }

    const history = await this.loadHistory(conversation.id, this.cfg.chatV2.historyMessages);
    const convSummary = await this.loadConversationSummary(conversation.id);

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
      tableEntityHints: dialogResult.queryPlan?.filters.entityHints ?? [],
      tableEntityIds: dialogResult.structuralFilters?.entityIds ?? [],
      tableAggregation: dialogResult.queryPlan?.filters.aggregation ?? false,
      conversationSummary: convSummary,
      intent: narrowToChatIntent(dialogResult.intent),
      onStage: input.onStage,
    });

    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.observeChatV2SynthesisDuration({
      mode,
      seconds: durationSeconds,
    });
    this.metrics.incChatV2Query({
      mode,
      channelOrigin: conversation.channelKindOrigin ?? input.channelKindOrigin ?? 'web',
    });
    const usedBlockIds = (result.retrievalMeta?.usedBlockIds as string[] | undefined) ?? [];
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
            dataClass: result.dataClass,
          },
        )
        .catch((err) => {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'AnswerCache.set promise rejected (handled inside)',
          );
        });
    }

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
      dataClass: result.dataClass,
    };
  }

  private async loadConversationSummary(conversationId: string): Promise<string | null> {
    const c = await this.prisma.chatV2Conversation.findUnique({
      where: { id: conversationId },
      select: { summary: true },
    });
    return c?.summary ?? null;
  }

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
    return items.reverse().map((m) => ({ role: m.role, content: m.text }));
  }
}

function coerceDataClass(v: unknown): DataClass {
  if (v === 'public' || v === 'internal' || v === 'sensitive' || v === 'private') {
    return v;
  }
  return 'sensitive';
}
