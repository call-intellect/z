import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AnswerCacheService, type AnswerCacheEntry } from './answer-cache.service';
import { MultiQueryExpansionService } from './multi-query-expansion.service';
import { QueryClassifierService, type DialogIntent } from './query-classifier.service';
import {
  QueryPlanExtractorService,
  type QueryPlanResult,
  type StructuralRetrievalFilters,
} from './query-plan-extractor.service';

export interface DialogProcessInput {
  tenantId: string;
  userId: string;
  userMessage: string;
  conversationId: string | null;
  scope: string;
  scopeRefId: string | null;
  validAt: string | null;
  intent?: DialogIntent;
}

export interface DialogProcessResult {
  enabled: boolean;
  standaloneQuestion: string;
  intent: DialogIntent;
  queries: string[];
  confidence: number;
  cachedAnswer: AnswerCacheEntry | null;
  queryPlan?: QueryPlanResult | null;
  structuralFilters?: StructuralRetrievalFilters | null;
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
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(MultiQueryExpansionService)
    private readonly multiQuery: MultiQueryExpansionService,
    @Inject(QueryPlanExtractorService)
    private readonly queryPlanExtractor: QueryPlanExtractorService,
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
        queryPlan: null,
        structuralFilters: null,
        steps: noopSteps,
      };
    }

    const question = input.userMessage;

    const { summary, history } = await this.loadConversationContext(input.conversationId);

    let intent: DialogIntent;
    let classifySeconds: number;
    if (input.intent) {
      intent = input.intent;
      classifySeconds = 0;
    } else {
      const cls = await this.classifier.classify({
        tenantId: input.tenantId,
        userId: input.userId,
        question,
        conversationId: input.conversationId,
      });
      intent = cls.intent;
      classifySeconds = cls.durationSeconds;
    }

    const cachedAnswer = await this.answerCache.get({
      tenantId: input.tenantId,
      userId: input.userId,
      standaloneQuestion: question,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: input.validAt,
    });

    const merged = await this.cfg.getDynamic<boolean>(
      'rag.understanding_merged',
      undefined,
      true,
    );

    let queries: string[];
    let queryPlan: QueryPlanResult | null = null;
    let structuralFilters: StructuralRetrievalFilters | null = null;
    let understandSeconds: number;

    if (merged) {
      const understandStart = Date.now();
      const todayIso = input.validAt ?? new Date().toISOString();
      const org = await this.prisma.org.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      });
      const understood = await this.queryPlanExtractor.understand({
        tenantId: input.tenantId,
        userId: input.userId,
        question,
        summary,
        history,
        todayIso,
        orgTimezone: org?.timezone ?? null,
        conversationId: input.conversationId,
      });
      queries = understood.queries;
      understandSeconds = (Date.now() - understandStart) / 1000;
      try {
        queryPlan = understood.queryPlan;
        structuralFilters = await this.queryPlanExtractor.resolveStructuralFilters({
          tenantId: input.tenantId,
          userId: input.userId,
          plan: understood.queryPlan,
        });
        this.metrics.incQueryPlanExtraction({
          result: understood.queryPlan.applied ? 'applied' : 'failopen',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { conversationId: input.conversationId, err: message },
          'resolveStructuralFilters (merged) упал — fail-open (без структурного фильтра)',
        );
        structuralFilters = null;
      }
    } else {
      const mq = await this.multiQuery.expand({
        tenantId: input.tenantId,
        userId: input.userId,
        question,
        intent,
        summary,
        history,
        conversationId: input.conversationId,
      });
      queries = mq.queries;
      understandSeconds = mq.durationSeconds;
      if (this.cfg.dialogLayer.queryPlanExtractionEnabled) {
        try {
          const todayIso = input.validAt ?? new Date().toISOString();
          const org = await this.prisma.org.findUnique({
            where: { id: input.tenantId },
            select: { timezone: true },
          });
          const planQuestions = mq.queries.length > 1 ? mq.queries.slice(1) : [...mq.queries];
          const plan = await this.queryPlanExtractor.extract({
            tenantId: input.tenantId,
            userId: input.userId,
            questions: planQuestions,
            todayIso,
            orgTimezone: org?.timezone ?? null,
            conversationId: input.conversationId,
          });
          queryPlan = plan;
          structuralFilters = await this.queryPlanExtractor.resolveStructuralFilters({
            tenantId: input.tenantId,
            userId: input.userId,
            plan,
          });
          this.metrics.incQueryPlanExtraction({
            result: plan.applied ? 'applied' : 'failopen',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            { conversationId: input.conversationId, err: message },
            'QueryPlan extraction упал — fail-open (без структурного фильтра)',
          );
          queryPlan = null;
          structuralFilters = null;
        }
      }
    }

    const totalSeconds = (Date.now() - totalStart) / 1000;
    this.metrics.observeDialogProcessingDuration({
      step: 'total',
      seconds: totalSeconds,
    });

    return {
      enabled: true,
      standaloneQuestion: question,
      intent,
      queries,
      confidence: 1.0,
      cachedAnswer,
      queryPlan,
      structuralFilters,
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: classifySeconds,
        multiQuery: understandSeconds,
        total: totalSeconds,
      },
    };
  }

  private async loadConversationContext(conversationId: string | null): Promise<{
    summary: string | null;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }> {
    if (!conversationId) {
      return { summary: null, history: [] };
    }
    const pairs = await this.cfg.getDynamic<number>(
      'dialog_layer.query_history_pairs',
      undefined,
      4,
    );
    const keepLast = Math.max(0, pairs) * 2;
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
    const history = rows.reverse().map((m) => ({ role: m.role, content: m.text }));
    return { summary, history };
  }
}
