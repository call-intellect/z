import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  AnswerCacheService,
  type AnswerCacheEntry,
} from './answer-cache.service';
import { ConfidenceEstimatorService } from './confidence-estimator.service';
import { ContextualizerService } from './contextualizer.service';
import {
  MultiQueryExpansionService,
} from './multi-query-expansion.service';
import {
  QueryClassifierService,
  type DialogIntent,
} from './query-classifier.service';

/**
 * SBA α-5 dialog-layer — DialogService (фасад).
 *
 * Препроцессор между ChatV2OrchestrationService.ask() и knowledge-core
 * ChatV2Service.ask(). См. plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md.
 *
 * Возвращает:
 *  - standaloneQuestion (контекстуализация + fallback на raw если confidence низкий);
 *  - intent (classifier);
 *  - queries[] (originalOrStandalone + multi-query expansion для exploratory/analytical);
 *  - cachedAnswer (если AnswerCache hit — pipeline возвращает ответ без вызова retrieval+LLM).
 *
 * При feature-flag `DIALOG_LAYER_ENABLED=false` — `process()` сразу
 * возвращает no-op результат (standaloneQuestion = userMessage, intent='factual').
 */

export interface DialogProcessInput {
  tenantId: string;
  userId: string;
  userMessage: string;
  conversationId: string | null;
  scope: string;
  scopeRefId: string | null;
  /** ISO date для temporal queries (null = `now`). */
  validAt: string | null;
}

export interface DialogProcessResult {
  enabled: boolean;
  standaloneQuestion: string;
  intent: DialogIntent;
  queries: string[];
  /** Уверенность контекстуализации (0..1). 1.0 если не было LLM-вызова. */
  confidence: number;
  /** Если ответ найден в AnswerCache — возвращаем его без вызова retrieval+LLM. */
  cachedAnswer: AnswerCacheEntry | null;
  /** Длительности шагов в секундах (для observability и admin-debug). */
  steps: {
    contextualize: number;
    confidence: number;
    classify: number;
    multiQuery: number;
    total: number;
  };
}

@Injectable()
export class DialogService {
  private readonly logger = new Logger(DialogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ContextualizerService)
    private readonly contextualizer: ContextualizerService,
    @Inject(ConfidenceEstimatorService)
    private readonly confidence: ConfidenceEstimatorService,
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(MultiQueryExpansionService)
    private readonly multiQuery: MultiQueryExpansionService,
    @Inject(AnswerCacheService) private readonly answerCache: AnswerCacheService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async process(input: DialogProcessInput): Promise<DialogProcessResult> {
    const totalStart = Date.now();
    const noopSteps = {
      contextualize: 0,
      confidence: 0,
      classify: 0,
      multiQuery: 0,
      total: 0,
    };

    if (!this.cfg.dialogLayer.enabled) {
      return {
        enabled: false,
        standaloneQuestion: input.userMessage,
        intent: 'factual',
        queries: [input.userMessage],
        confidence: 1.0,
        cachedAnswer: null,
        steps: noopSteps,
      };
    }

    // 1. Загружаем summary + последние N сообщений диалога (для контекстуализации).
    const { summary, history } = await this.loadConversationContext(
      input.conversationId,
    );

    // 2. Contextualize.
    const ctx = await this.contextualizer.contextualize({
      tenantId: input.tenantId,
      userId: input.userId,
      question: input.userMessage,
      summary,
      history,
      conversationId: input.conversationId,
    });

    // 3. Confidence (только если standalone != original).
    const conf = await this.confidence.estimate({
      tenantId: input.tenantId,
      userId: input.userId,
      originalQuestion: input.userMessage,
      standaloneQuestion: ctx.standaloneQuestion,
      conversationId: input.conversationId,
    });

    // Если confidence низкий — fallback на raw userMessage. Это критично:
    // плохая переформулировка может радикально изменить retrieval.
    const finalQuestion = conf.shouldFallback
      ? input.userMessage
      : ctx.standaloneQuestion;

    // 4. AnswerCache lookup ДО classifier/multi-query — самый быстрый
    //    путь. Ключ — по итоговому standalone (с учётом fallback'а).
    const cachedAnswer = await this.answerCache.get({
      tenantId: input.tenantId,
      userId: input.userId,
      standaloneQuestion: finalQuestion,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: input.validAt,
    });

    // 5. Classify (нужен для решения по multi-query + для mode-prompt'а).
    const cls = await this.classifier.classify({
      tenantId: input.tenantId,
      userId: input.userId,
      question: finalQuestion,
      conversationId: input.conversationId,
    });

    // 6. MultiQuery (только для exploratory/analytical).
    const mq = await this.multiQuery.expand({
      tenantId: input.tenantId,
      userId: input.userId,
      question: finalQuestion,
      intent: cls.intent,
      conversationId: input.conversationId,
    });

    const totalSeconds = (Date.now() - totalStart) / 1000;
    this.metrics.observeDialogProcessingDuration({
      step: 'total',
      seconds: totalSeconds,
    });

    return {
      enabled: true,
      standaloneQuestion: finalQuestion,
      intent: cls.intent,
      queries: mq.queries,
      confidence: conf.confidence,
      cachedAnswer,
      steps: {
        contextualize: ctx.durationSeconds,
        confidence: conf.durationSeconds,
        classify: cls.durationSeconds,
        multiQuery: mq.durationSeconds,
        total: totalSeconds,
      },
    };
  }

  /**
   * Загружает summary + последние N сообщений для контекстуализации.
   * Окно — `summarizerKeepLast` (default 6) последних сообщений
   * (без текущего user-message, который ещё не записан в БД на момент
   * вызова process()).
   */
  private async loadConversationContext(
    conversationId: string | null,
  ): Promise<{
    summary: string | null;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }> {
    if (!conversationId) {
      return { summary: null, history: [] };
    }
    const keepLast = this.cfg.dialogLayer.summarizerKeepLast;
    const conv = await this.prisma.chatV2Conversation.findUnique({
      where: { id: conversationId },
      select: { summary: true },
    });
    const summary = conv?.summary ?? null;
    if (keepLast <= 0) {
      return { summary, history: [] };
    }
    const rows = await this.prisma.chatV2Message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: keepLast,
      select: { role: true, text: true },
    });
    const history = rows
      .reverse()
      .map((m) => ({ role: m.role, content: m.text }));
    return { summary, history };
  }
}
