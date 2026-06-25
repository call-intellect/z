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
import { tryParseJson } from '../ai/services/json-extract.util';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../ai/services/prompts/common';
import { AnswerCacheService } from '../dialog-layer/services/answer-cache.service';
import { DialogService } from '../dialog-layer/services/dialog.service';
import {
  type DialogIntent,
  narrowToChatIntent,
} from '../dialog-layer/services/query-classifier.service';
import {
  RAG_GROUNDEDNESS_SYSTEM_PROMPT,
  RagGroundednessSchema,
  buildRagGroundednessUser,
} from '../knowledge-core/prompts/rag-pipeline.prompts';
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
  intent?: DialogIntent;
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
    @Inject(LlmRouterService)
    private readonly llm: LlmRouterService,
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
      intent: input.intent,
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

    const gated = await this.applyGroundednessGate({
      tenantId: input.tenantId,
      userId: input.userId,
      question: input.question,
      text: result.text,
      citations: result.citations,
      usedBlockIds,
    });
    const answerText = gated.text;
    const answerCitations = gated.citations;

    const assistantMessage = await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      mode,
      text: answerText,
      citations:
        answerCitations.length > 0
          ? (answerCitations as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      retrievalMeta: result.retrievalMeta as Prisma.InputJsonValue,
      llmMeta: result.llmMeta as Prisma.InputJsonValue,
    });

    if (dialogResult.enabled && answerText.length > 0) {
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
            text: answerText,
            citations: answerCitations,
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
      text: answerText,
      citations: answerCitations,
      uncertaintyNote: result.uncertaintyNote,
      mode,
      cacheHit: false,
      dataClass: result.dataClass,
    };
  }

  private async applyGroundednessGate(args: {
    tenantId: string;
    userId: string;
    question: string;
    text: string;
    citations: unknown[];
    usedBlockIds: string[];
  }): Promise<{ text: string; citations: unknown[] }> {
    const unchanged = { text: args.text, citations: args.citations };

    const mode = await this.cfg.getDynamic<string>('rag.groundedness_mode', undefined, 'on');
    if (mode === 'off') {
      return unchanged;
    }

    let blocksStr = '';
    if (args.usedBlockIds.length > 0) {
      try {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: args.usedBlockIds.slice(0, GROUNDEDNESS_MAX_BLOCKS) }, tenantId: args.tenantId },
          select: { id: true, name: true, trustedAnswer: true },
        });
        blocksStr = blocks
          .map((b) => `[BLOCK:${b.id}] ${b.name}: ${b.trustedAnswer}`)
          .join('\n')
          .slice(0, GROUNDEDNESS_BLOCKS_CHAR_LIMIT);
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'applyGroundednessGate: загрузка блоков упала — fail-open',
        );
        return unchanged;
      }
    }

    let grounded: boolean;
    try {
      const out = await this.llm.call({
        taskType: 'rag-groundedness',
        tenantId: args.tenantId,
        userId: args.userId,
        systemPrompt: withInjectionGuard(RAG_GROUNDEDNESS_SYSTEM_PROMPT),
        userMessage: wrapUserData(
          buildRagGroundednessUser(args.question, args.text, blocksStr),
        ),
        responseFormat: { type: 'json_object' },
        maxTokens: 200,
        dataClass: 'internal',
      });
      const parsed = RagGroundednessSchema.safeParse(tryParseJson(out.text));
      if (!parsed.success) {
        return unchanged;
      }
      grounded = parsed.data.grounded;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'applyGroundednessGate: LLM-вызов упал — fail-open',
      );
      return unchanged;
    }

    if (grounded) {
      return unchanged;
    }

    if (mode === 'shadow') {
      this.metrics.incRagAbstain({ mode: 'shadow' });
      return unchanged;
    }

    this.metrics.incRagAbstain({ mode: 'on' });
    return { text: GROUNDEDNESS_HONEST_ABSTAIN, citations: [] };
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

const GROUNDEDNESS_MAX_BLOCKS = 15;
const GROUNDEDNESS_BLOCKS_CHAR_LIMIT = 12_000;
const GROUNDEDNESS_HONEST_ABSTAIN =
  'В памяти компании я этого не нашёл — не хочу выдумывать. Уточните вопрос, и я поищу ещё.';
