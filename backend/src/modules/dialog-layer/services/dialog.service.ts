import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  AnswerCacheService,
  type AnswerCacheEntry,
} from './answer-cache.service';
import {
  MultiQueryExpansionService,
} from './multi-query-expansion.service';
import {
  QueryClassifierService,
  type DialogIntent,
} from './query-classifier.service';
import {
  QueryPlanExtractorService,
  type QueryPlanResult,
  type StructuralRetrievalFilters,
} from './query-plan-extractor.service';

/**
 * dialog-layer — DialogService (фасад). ТЗ 2026-06-14 (слитый «модуль
 * понимания запроса»).
 *
 * Препроцессор между ChatV2OrchestrationService.ask() и knowledge-core
 * ChatV2Service.ask(). Новый порядок process():
 *   loadContext → classify(сырая реплика) → answerCache(сырая)
 *   → multiQuery.expand(сырая+summary+history → 3 самодостаточных вопроса)
 *   → queryPlan.extract(3 вопроса без оригинала → объединённый план).
 *
 * Контекстуализатор (№1) и оценщик уверенности (№2) удалены — их работу
 * полностью покрывает слитый шаг multiQuery.expand (history-aware).
 *
 * Возвращает:
 *  - standaloneQuestion (= сырая реплика; раскрытие сущностей теперь внутри expand);
 *  - intent (classifier по сырой реплике);
 *  - queries[] (originalQuestion + 3 самодостаточных формулировки);
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
  /**
   * DEPRECATED (ТЗ 2026-06-14): оценщик уверенности удалён. Поле сохранено для
   * совместимости потребителей (chat-v2 / concierge) — всегда 1.0.
   */
  confidence: number;
  /** Если ответ найден в AnswerCache — возвращаем его без вызова retrieval+LLM. */
  cachedAnswer: AnswerCacheEntry | null;
  /** Query Understanding Волна 1 — сырой план запроса (для observability/metrics). null если выключено/не применился. */
  queryPlan?: QueryPlanResult | null;
  /** Query Understanding Волна 1 — резолвнутые структурные фильтры для recall-safe ретрива (Ф3). null если фильтровать нечем. */
  structuralFilters?: StructuralRetrievalFilters | null;
  /**
   * Длительности шагов в секундах (для observability и admin-debug).
   * `contextualize`/`confidence` сохранены для совместимости — всегда 0
   * (агенты удалены, ТЗ 2026-06-14).
   */
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

    // Сырая реплика — больше нет отдельного контекстуализатора/оценщика.
    // Раскрытие сущностей («это/он/там» → имена из истории) теперь внутри
    // multiQuery.expand (слитый «модуль понимания запроса»).
    const question = input.userMessage;

    // 1. Загружаем summary + последние N сообщений диалога — кормят expand.
    const { summary, history } = await this.loadConversationContext(
      input.conversationId,
    );

    // 2. Classify по СЫРОЙ реплике (для выбора режима ответа + бот-интентов;
    //    эвристики работают по сырому тексту).
    const cls = await this.classifier.classify({
      tenantId: input.tenantId,
      userId: input.userId,
      question,
      conversationId: input.conversationId,
    });

    // 3. AnswerCache lookup по сырой реплике — самый быстрый путь.
    const cachedAnswer = await this.answerCache.get({
      tenantId: input.tenantId,
      userId: input.userId,
      standaloneQuestion: question,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: input.validAt,
    });

    // 4. MultiQuery = слитый «модуль понимания запроса». Кормим сырой
    //    репликой + summary + история → 3 самодостаточных вопроса.
    const mq = await this.multiQuery.expand({
      tenantId: input.tenantId,
      userId: input.userId,
      question,
      intent: cls.intent,
      summary,
      history,
      conversationId: input.conversationId,
    });

    // 5. Query Understanding Волна 1 — извлечение структуры запроса ПОСЛЕ
    //    expand и по ТРЁМ формулировкам (без оригинала: имена/темы живут в
    //    истории и раскрываются только расширителем). Под флагом, fail-open.
    let queryPlan: QueryPlanResult | null = null;
    let structuralFilters: StructuralRetrievalFilters | null = null;
    if (this.cfg.dialogLayer.queryPlanExtractionEnabled) {
      try {
        const todayIso = input.validAt ?? new Date().toISOString();
        const org = await this.prisma.org.findUnique({
          where: { id: input.tenantId },
          select: { timezone: true },
        });
        // Извлекателю — 3 самодостаточных формулировки БЕЗ оригинала. Если
        // expand вернул только оригинал (выключен/упал) — отдаём что есть.
        const planQuestions =
          mq.queries.length > 1 ? mq.queries.slice(1) : [...mq.queries];
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

    const totalSeconds = (Date.now() - totalStart) / 1000;
    this.metrics.observeDialogProcessingDuration({
      step: 'total',
      seconds: totalSeconds,
    });

    return {
      enabled: true,
      standaloneQuestion: question,
      intent: cls.intent,
      queries: mq.queries,
      // Оценщик уверенности удалён (ТЗ 2026-06-14) — поле сохранено = 1.0.
      confidence: 1.0,
      cachedAnswer,
      queryPlan,
      structuralFilters,
      steps: {
        contextualize: 0,
        confidence: 0,
        classify: cls.durationSeconds,
        multiQuery: mq.durationSeconds,
        total: totalSeconds,
      },
    };
  }

  /**
   * Загружает summary + последние N сообщений диалога для контекстуализации
   * follow-up'ов модулем понимания запроса. Глубина — крутилка AdminSetting
   * `dialog_layer.query_history_pairs` (пар сообщений, дефолт 4 → 8 сообщений);
   * НЕ `summarizerKeepLast` (им владеет крон-суммаризатор). Окно без текущего
   * user-message (он ещё не записан в БД на момент вызова process()).
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
    const history = rows
      .reverse()
      .map((m) => ({ role: m.role, content: m.text }));
    return { summary, history };
  }
}
