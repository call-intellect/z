import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ConciergeConversation,
  type ConciergeMessage,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiChatQuotaService } from '../../ai-chat-quota/ai-chat-quota.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  LlmRouterService,
  type LlmCallResult,
} from '../../ai/services/llm-router.service';
import {
  DialogService,
  type DialogProcessResult,
} from '../../dialog-layer/services/dialog.service';
import type { DialogIntent } from '../../dialog-layer/services/query-classifier.service';
import { QuotaExceededError } from '../../quotas/quota.errors';
import type { PageContextDto } from '../dto/concierge.dto';

import { ConciergeContextBuilderService } from './concierge-context-builder.service';
import { ConciergeQuotaService } from './concierge-quota.service';
import { ConciergeUndoLogService } from './concierge-undo-log.service';
import { ServiceMapGeneratorService } from './service-map-generator.service';
import {
  ConciergeStepScorerService,
  type StepCandidate,
  type StepScore,
} from './step-scorer.service';
import { ToolRouterService } from './tool-router.service';

/**
 * SBA γ-2 — ConciergeService.
 *
 * Главный фасад модуля. Выполняет tool-use loop:
 *
 *   1. Builds context (identity + page).
 *   2. Loads / creates ConciergeConversation, persists user message.
 *   3. Calls LLM (taskType='concierge-respond') c ToolSchema'ми.
 *   4. Если LLM вернул tool_calls — выполняет каждый через ToolRouter,
 *      пишет ConciergeMessage(role='tool') и ConciergeUndoLog.
 *   5. Зацикливает: ещё один вызов LLM с tool results → финальный ответ
 *      или новый tool_call. Максимум `MAX_TOOL_LOOP_ITERATIONS` итераций.
 *   6. Финальный assistant-ответ пишется в ConciergeMessage(role='assistant')
 *      и эмиттится через AsyncIterable (для SSE controller'а).
 *
 * Это MVP версия: реальный tool-use protocol (Anthropic/OpenAI tool_use)
 * пока эмулируется через JSON-инструкцию в системном промпте. vNext —
 * native tool-use через provider-специфичный API.
 */

const MAX_TOOL_LOOP_ITERATIONS = 5;
const K_RECENT_MESSAGES = 6;

export interface ProcessInput {
  userMessage: string;
  conversationId?: string | null;
  pageContext?: PageContextDto | null;
  userId: string;
  tenantId: string;
  /**
   * Базовый URL backend'а для loopback tool-вызовов. Обязателен в
   * cookie-режиме (web-чат, берётся из HTTP-запроса); в service-режиме
   * (Ф5 assistant-channels: Telegram/MAX без HTTP-запроса) опционален —
   * ToolRouter сам резолвит `cfg.concierge.loopbackBaseUrl`.
   */
  baseUrl?: string;
  authCookie?: string;
  /**
   * Ф5 assistant-channels (2026-06-11) — режим аутентификации loopback
   * tool-вызовов (см. ToolRouterService Ф4). Default `'cookie'` — прежнее
   * поведение web-чата (passthrough authCookie). `'service'` — каналы
   * Telegram/MAX: ToolRouter минтит короткоживущую session-JWT по userId.
   */
  authMode?: 'cookie' | 'service';
}

/**
 * Pure helper: собирает «user message» для одной итерации tool-loop.
 *
 * Экспортируется отдельно от класса, чтобы покрыть unit-тестами без
 * необходимости поднимать NestJS DI / PrismaService.
 *
 * F1 cache-friendly (мастер-промпт-флот 2026-06-10): предварительные
 * результаты поиска (`preHits`) переехали сюда из SYSTEM — это переменные
 * данные на каждый запрос, а SYSTEM должен оставаться стабильным
 * (см. `buildSystemPrompt`).
 *
 * Структура output (в порядке появления):
 *   1. `КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:` + summary (если задан)
 *   2. `История диалога:` + последние N сообщений (если есть)
 *   3. `Результаты последних tool вызовов:` (если есть)
 *   4. `=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===` + preHits (если есть)
 *   5. `Новый запрос пользователя: <userMessage>`
 */
/**
 * Pure helper (ТЗ 2026-05-27 Фаза 5): собирает СИСТЕМНЫЙ промпт.
 *
 * Вынесен из метода класса, чтобы покрыть snapshot-тестами без поднятия
 * NestJS DI. `toolFragment` передаётся параметром (раньше брался через
 * `this.serviceMap.buildToolUsePromptFragment()`).
 *
 * F1 cache-friendly (мастер-промпт-флот 2026-06-10, Кластер 7-B/A8):
 * предварительные результаты поиска (`preHits`) — это ПЕРЕМЕННЫЕ данные на
 * каждый запрос, поэтому они БОЛЬШЕ НЕ в SYSTEM. SYSTEM держим стабильным
 * (контекст пользователя + tool-fragment + принципы), а preHits переехали в
 * user-сообщение (`composeUserMessageForIteration`, блок
 * `=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===`). Это держит SYSTEM-префикс
 * стабильным → prompt-cache hit ≈99% (см. feedback
 * `LLM-промпты — обязательно cache-friendly`).
 *
 * Структура output (в порядке появления):
 *   1. Преамбула (роль ассистента).
 *   2. `=== КОНТЕКСТ ===` + contextBlock (или fallback).
 *   3. `=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===` + tool-use инструкции + toolFragment
 *      (только при `nativeTools !== true` — legacy regex-эмуляция); при
 *      native function-calling (Ф3 assistant-channels, 2026-06-11) вместо
 *      него — две стабильные строки про инструменты (tools уходят провайдеру
 *      через `LlmCallParams.tools`, SYSTEM остаётся cache-friendly).
 *   4. Принципы.
 */
export function buildSystemPrompt(args: {
  contextBlock: string;
  toolFragment: string;
  /**
   * Ф3 assistant-channels (2026-06-11) — native function-calling. При `true`
   * SYSTEM собирается БЕЗ JSON-инструкции `{"tool_call"}` и БЕЗ списка
   * инструментов (`toolFragment` игнорируется): tools передаются провайдеру
   * нативно. Опционально — legacy-вызовы без поля работают как раньше.
   */
  nativeTools?: boolean;
}): string {
  const parts: string[] = [
    'Ты — Concierge, AI-помощник в кабинете компании Z (Кора).',
    'Отвечай по-русски, кратко и по делу.',
    '',
    '=== КОНТЕКСТ ===',
    args.contextBlock || '(контекст недоступен)',
    '',
  ];
  if (args.nativeTools === true) {
    parts.push(
      'Тебе доступны инструменты через function-calling.',
      'Вызывай инструмент, когда запрос требует действия или данных; иначе отвечай текстом.',
      '',
    );
  } else {
    parts.push(
      '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
      'Если запрос требует действия — верни ОДНУ строку строго в формате JSON:',
      '{"tool_call": {"name": "<имя>", "arguments": { ... }}}',
      'Если действие не требуется — верни просто текст ответа без JSON.',
      'Имя инструмента ДОЛЖНО быть из списка ниже:',
      args.toolFragment,
      '',
    );
  }
  parts.push(
    'Принципы:',
    '- Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.',
    '- Если в пользовательском сообщении есть блок «=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===» — опирайся на него; если данных достаточно, отвечай без новых вызовов search_knowledge.',
    '- Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).',
    '- Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос.',
  );
  return parts.join('\n');
}

export function composeUserMessageForIteration(args: {
  userMessage: string;
  toolMessages: Array<{ role: 'tool'; content: string }>;
  history: Array<Pick<ConciergeMessage, 'role' | 'content'>>;
  summary: string | null;
  /**
   * F1 cache-friendly — предварительные результаты поиска (pre-retrieval).
   * Переехали из SYSTEM в user (см. `buildSystemPrompt`). Опционально:
   * legacy-вызовы без preHits продолжают работать (старые snapshot-тесты).
   */
  preHits?: Array<{ query: string; result: unknown }>;
}): string {
  const parts: string[] = [];
  if (args.summary != null && args.summary.trim() !== '') {
    parts.push('КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:');
    parts.push(args.summary);
    parts.push('');
  }
  if (args.history.length > 0) {
    parts.push('История диалога:');
    for (const m of args.history) {
      const role =
        m.role === 'user'
          ? 'Пользователь'
          : m.role === 'assistant'
            ? 'Ассистент'
            : 'Tool';
      parts.push(`[${role}] ${m.content.slice(0, 500)}`);
    }
    parts.push('');
  }
  if (args.toolMessages.length > 0) {
    parts.push('Результаты последних tool вызовов:');
    for (const tm of args.toolMessages) {
      parts.push(`- ${tm.content}`);
    }
    parts.push('');
  }
  // ТЗ 2026-05-27 Фаза 3 (pre-retrieval) + F1 cache-friendly (2026-06-10):
  // блок предварительных результатов теперь в user, не в SYSTEM.
  if (args.preHits != null && args.preHits.length > 0) {
    parts.push('=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===');
    parts.push(
      'Вот что нашлось в графе компании по этому вопросу. Если этого достаточно — отвечай по этим данным без дополнительных вызовов. Если данных мало — ты можешь вызвать search_knowledge сам.',
    );
    parts.push('');
    parts.push(JSON.stringify(args.preHits, null, 2));
    parts.push('');
  }
  parts.push(`Новый запрос пользователя: ${args.userMessage}`);
  return parts.join('\n');
}

export type ConciergeStreamEvent =
  | { type: 'started'; conversationId: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_call';
      toolName: string;
      params: Record<string, unknown>;
      requiresConfirm: boolean;
    }
  | {
      type: 'tool_result';
      toolName: string;
      ok: boolean;
      status: number;
      undoLogId?: string;
      preview: string;
      /**
       * Smart-tables ТЗ Фаза 1 — для whitelist-инструментов с богатым превью
       * (см. RICH_PREVIEW_TOOLS) кладём ПОЛНЫЙ результат, чтобы фронт мог
       * отрисовать интерактивную карточку (например, превью схемы таблицы).
       * Для остальных инструментов поле отсутствует — достаточно `preview`.
       */
      data?: unknown;
    }
  | { type: 'message'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'quota_exceeded';
      scope: 'user_daily' | 'daily' | 'monthly';
      /** ТЗ 2026-05-31 — для `user_daily` приходит из QuotaService (Retry-After в секундах). */
      retryAfterSeconds?: number;
    };

/**
 * Smart-tables ТЗ Фаза 1 — инструменты, для которых в SSE-событие `tool_result`
 * прокидывается ПОЛНЫЙ результат (`data`), а не только текстовый `preview`.
 * Нужно фронту для интерактивных карточек (например, превью схемы таблицы).
 */
const RICH_PREVIEW_TOOLS = new Set<string>(['infer_table_schema']);

@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ConciergeContextBuilderService)
    private readonly contextBuilder: ConciergeContextBuilderService,
    @Inject(ServiceMapGeneratorService)
    private readonly serviceMap: ServiceMapGeneratorService,
    @Inject(ToolRouterService) private readonly toolRouter: ToolRouterService,
    @Inject(ConciergeUndoLogService)
    private readonly undoLog: ConciergeUndoLogService,
    @Inject(ConciergeQuotaService) private readonly quota: ConciergeQuotaService,
    /**
     * ТЗ 2026-05-31 — единая per-user квота AI-чата (Concierge + Clones).
     * Проверяется ДО per-Org safety-net `quota.tryConsume(tenantId)`.
     * `AiChatQuotaModule` подключён `@Global`, явный import в `ConciergeModule`
     * не требуется.
     */
    @Inject(AiChatQuotaService)
    private readonly aiChatQuota: AiChatQuotaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    /**
     * ТЗ 2026-05-27 Фаза 2 — dialog-layer фасад. `@Optional()` — фича
     * включается флагом `CONCIERGE_DIALOG_LAYER_ENABLED` (default false);
     * существующие unit-тесты, мокающие конструктор без 11-го аргумента,
     * остаются совместимыми. `DialogLayerModule` @Global — явный import
     * в `ConciergeModule` не требуется.
     */
    @Optional()
    @Inject(DialogService)
    private readonly dialog: DialogService | null = null,
    /**
     * Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow).
     * `@Optional()` — фича включается флагом `CONCIERGE_PRM_SHADOW_ENABLED`
     * (default false). Существующие unit-тесты, мокающие конструктор без
     * 12-го аргумента, остаются совместимыми.
     */
    @Optional()
    @Inject(ConciergeStepScorerService)
    private readonly stepScorer: ConciergeStepScorerService | null = null,
  ) {}

  /**
   * Главный метод: возвращает AsyncIterable<ConciergeStreamEvent>, который
   * controller сериализует в SSE.
   */
  async *process(input: ProcessInput): AsyncIterable<ConciergeStreamEvent> {
    if (!this.cfg.concierge.enabled) {
      yield {
        type: 'error',
        code: 'concierge_disabled',
        message: 'Concierge Agent отключён в этой среде',
      };
      return;
    }

    // ТЗ 2026-05-31 — единая per-user квота AI-чата (Concierge + Clones).
    // Проверяется ДО per-Org safety-net `quota.tryConsume(tenantId)`.
    try {
      await this.aiChatQuota.tryConsume({
        tenantId: input.tenantId,
        userId: input.userId,
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        yield {
          type: 'quota_exceeded',
          scope: 'user_daily',
          retryAfterSeconds: err.retryAfterSeconds,
        };
        return;
      }
      throw err;
    }

    // Per-Org safety-net quota check (остаётся как было — защита Org от
    // суммарного перебора, например ботами/массовой авторассылкой).
    const denial = await this.quota.tryConsume(input.tenantId);
    if (denial) {
      yield { type: 'quota_exceeded', scope: denial.scope };
      return;
    }

    this.metrics.incConciergeMessage?.({
      tenantTop: this.tenantTop(input.tenantId),
    });

    // Conversation: get or create.
    const conversation = await this.loadOrCreateConversation(input);
    yield { type: 'started', conversationId: conversation.id };

    // Save user message.
    await this.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: input.userMessage,
    });

    // ТЗ 2026-05-27 Фаза 2 — dialog-layer препроцессор (за флагом).
    // Контекстуализирует вопрос (follow-up'ы → standalone), классифицирует
    // intent и проверяет AnswerCache. При cache-hit возвращаем ответ без
    // LLM-вызова (short-circuit ниже).
    let dialogResult: DialogProcessResult | null = null;
    if (this.isDialogLayerEnabled()) {
      try {
        dialogResult = await this.dialog!.process({
          tenantId: input.tenantId,
          userId: input.userId,
          userMessage: input.userMessage,
          conversationId: conversation.id,
          scope: 'concierge',
          scopeRefId: conversation.id,
          validAt: null,
        });
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'concierge dialog-layer process failed (fallback to legacy)',
        );
        dialogResult = null;
      }

      // ТЗ 2026-05-27 Фаза 4 — метрика+лог dialog-layer применения.
      if (dialogResult != null) {
        this.metrics.incConciergeDialogLayerUsed?.({
          intent: dialogResult.intent,
        });
        this.logger.debug(
          {
            feature: 'concierge',
            stage: 'dialog-layer',
            intent: dialogResult.intent,
            confidence: dialogResult.confidence,
            queriesCount: dialogResult.queries.length,
            cacheHit: dialogResult.cachedAnswer !== null,
            conversationId: conversation.id,
          },
          'dialog-layer applied',
        );
      }

      // Cache short-circuit: AnswerCache hit — отдаём ответ без LLM-цикла.
      if (dialogResult?.cachedAnswer != null) {
        // ТЗ 2026-05-27 Фаза 4 — метрика cache-hit.
        this.metrics.incConciergeCacheHit?.();
        yield { type: 'thinking', text: 'Нашёл ответ в кэше' };
        const cachedText = dialogResult.cachedAnswer.text;
        const cachedMsg = await this.appendMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: cachedText,
          toolCalls: {
            dialogLayer: {
              enabled: true,
              intent: dialogResult.intent,
              confidence: dialogResult.confidence,
              queriesCount: dialogResult.queries.length,
              cacheHit: true,
            },
          },
        });
        yield { type: 'message', text: cachedText };
        yield { type: 'done', messageId: cachedMsg.id };
        // audit С24 (2026-05-29): defense-in-depth — updateMany с tenantId,
        // чтобы даже при race (mutated conversation.id) не апдейтить чужую
        // запись. updateMany возвращает count=0 без throw, что безопасно.
        await this.prisma.conciergeConversation.updateMany({
          where: { id: conversation.id, tenantId: input.tenantId },
          data: { lastMessageAt: new Date() },
        });
        return;
      }
    }

    const effectiveQuestion = dialogResult?.standaloneQuestion ?? input.userMessage;

    // ТЗ 2026-05-27 Фаза 3 — pre-retrieval: параллельный поиск по `queries[]`
    // через ToolRouter ДО первой LLM-итерации. Результаты подмешиваются в
    // системный промпт (один на весь loop), не дублируются в follow-up'ах.
    const preRetrievalAttempted = dialogResult != null && !dialogResult.cachedAnswer;
    const preRetrievalStart = preRetrievalAttempted ? Date.now() : 0;
    const preHits = preRetrievalAttempted
      ? await this.preRetrieve({
          queries: dialogResult!.queries,
          intent: dialogResult!.intent,
          userId: input.userId,
          tenantId: input.tenantId,
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          ...(input.authMode ? { authMode: input.authMode } : {}),
          ...(input.authCookie ? { authCookie: input.authCookie } : {}),
        })
      : [];

    // ТЗ 2026-05-27 Фаза 4 — метрики+логи pre-retrieval.
    let totalHits = 0;
    let uniqueIdsCount = 0;
    if (preRetrievalAttempted) {
      const seenIds = new Set<string>();
      for (const hit of preHits) {
        const items = this.extractItems(hit.result);
        totalHits += items.length;
        for (const item of items) {
          const id = this.extractId(item);
          if (id != null) seenIds.add(id);
        }
      }
      uniqueIdsCount = seenIds.size;
      this.metrics.observeConciergePreRetrievalHits?.(totalHits);
      this.logger.debug(
        {
          feature: 'concierge',
          stage: 'pre-retrieval',
          intent: dialogResult!.intent,
          queriesCount: dialogResult!.queries.length,
          queriesUsed: preHits.length,
          hits: totalHits,
          uniqueIds: uniqueIdsCount,
          durationMs: Date.now() - preRetrievalStart,
          conversationId: conversation.id,
        },
        'pre-retrieval done',
      );
    }

    if (preHits.length > 0) {
      yield {
        type: 'thinking',
        text: `Нашёл ${totalHits} релевантных записей в графе`,
      };
    }

    // Build context.
    const contextBlock = await this.contextBuilder.build({
      tenantId: input.tenantId,
      userId: input.userId,
      pageContext: input.pageContext ?? null,
    });

    // Ф3 assistant-channels (2026-06-11) — kill-switch native function-calling.
    // Читаем ОДИН раз на запрос: ON — tools уходят провайдеру нативно
    // (`LlmCallParams.tools`), SYSTEM без JSON-инструкции; OFF — прежняя
    // regex-эмуляция через tryParseToolCall (поведение без изменений).
    const nativeTools = this.isNativeToolsEnabled();
    const llmTools = nativeTools ? this.serviceMap.toLlmTools() : [];

    // F1 cache-friendly — SYSTEM стабилен (без preHits); preHits едут в user.
    const rawSystemPrompt = this.buildSystemPrompt(contextBlock, nativeTools);

    // E2 (мастер-ТЗ Волна 1, Кластер A) — анти-инъекционная обёртка. Concierge
    // дёргает мутирующие tools, поэтому пользовательский ввод обязан идти в LLM
    // в маркерах данных, а system — с INJECTION_GUARD_NOTE. Обёртку system
    // делаем ОДИН раз (cache-friendly: стабильный суффикс, не на каждой
    // итерации), user-блок оборачиваем внутри loop. Observability — sanitize по
    // самому запросу пользователя (source='chat'), без отклонения промта.
    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(effectiveQuestion);
      for (const pattern of sanitized.reasons) {
        this.metrics.incPromptInjectionAttempt?.({ source: 'chat', pattern });
      }
    }
    const systemPrompt = guardOn
      ? withInjectionGuard(rawSystemPrompt)
      : rawSystemPrompt;
    const history = await this.loadRecentHistory(conversation.id, K_RECENT_MESSAGES);

    // Tool-use loop (эмулируется через JSON в ответе LLM).
    let toolMessages: Array<{ role: 'tool'; content: string }> = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      const rawUserBlock = composeUserMessageForIteration({
        userMessage: effectiveQuestion,
        toolMessages,
        history,
        summary: conversation.summary,
        // F1 cache-friendly — pre-retrieval результаты теперь в user-блоке
        // (раньше вшивались в SYSTEM на каждый запрос, ломая prompt-cache).
        preHits,
      });
      // E2 — обернуть весь user-блок в маркеры данных (идемпотентно, system
      // уже несёт INJECTION_GUARD_NOTE; см. systemPrompt выше).
      const userBlock = guardOn ? wrapUserData(rawUserBlock) : rawUserBlock;

      // Ф3 — единая точка: `parsed` заполняется из двух источников —
      // native function-calling (out.toolCalls) или legacy regex-эмуляции
      // (tryParseToolCall по тексту). Дальше оба пути идут по ОДНОМУ
      // существующему конвейеру (requiresConfirm → ToolRouter.execute →
      // undo-log → SSE tool_call/tool_result → toolMessages).
      let parsed:
        | { kind: 'tool_call'; toolName: string; params: Record<string, unknown> }
        | { kind: 'final'; text: string };
      try {
        const out = await this.llm.call({
          taskType: 'concierge-respond',
          systemPrompt,
          userMessage: userBlock,
          tenantId: input.tenantId,
          userId: input.userId,
          maxTokens: 1500,
          // Ф3 — native: tools уходят провайдеру (tool_choice='auto'
          // ставится адаптером автоматически, см. LlmCallParams.tools).
          ...(nativeTools ? { tools: llmTools } : {}),
        });
        parsed = nativeTools
          ? this.toolCallFromNativeOutput(out)
          : this.tryParseToolCall(out.text);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.logger.error({ err: m }, 'concierge LLM call failed');
        yield {
          type: 'error',
          code: 'llm_error',
          message: 'LLM временно недоступен',
        };
        return;
      }

      if (parsed.kind === 'final') {
        finalText = parsed.text;
        yield { type: 'thinking', text: 'Готовлю ответ…' };
        break;
      }

      // tool_call path
      const toolName = parsed.toolName;
      const params = parsed.params;
      const tool = this.serviceMap.findTool(toolName);
      const requiresConfirm =
        !!tool &&
        tool.method !== 'GET' &&
        !tool.undoableVia;

      yield {
        type: 'tool_call',
        toolName,
        params,
        requiresConfirm,
      };

      // Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow).
      // Запускаем PARALLEL c execution, чтобы не блокировать ответ пользователю.
      // Никогда не подменяем LLM-выбор — это shadow mode. См.
      // plans/tz/2026-05-29-agents-v2-umbrella.md §B2.
      const shadowScoringPromise = this.maybeStartShadowScoring({
        llmCandidate: { toolName, args: params },
        systemPrompt,
        userMessage: userBlock,
        tenantId: input.tenantId,
        userId: input.userId,
        effectiveQuestion,
        history,
        preHits,
      });

      // Execute через ToolRouter. Ф5: authMode/baseUrl опциональны —
      // service-режим (каналы) резолвит baseUrl внутри ToolRouter.
      const execResult = await this.toolRouter.execute({
        toolName,
        args: params,
        userId: input.userId,
        tenantId: input.tenantId,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        ...(input.authMode ? { authMode: input.authMode } : {}),
        ...(input.authCookie ? { authCookie: input.authCookie } : {}),
      });

      let undoLogId: string | undefined;
      if (execResult.ok && tool && tool.method !== 'GET') {
        try {
          const log = await this.undoLog.record({
            tenantId: input.tenantId,
            conversationId: conversation.id,
            tool: execResult.tool,
            params,
            result: execResult.result,
          });
          undoLogId = log.id;
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'undoLog.record failed (non-fatal)',
          );
        }
      }

      const preview = this.previewResult(execResult.result);
      yield {
        type: 'tool_result',
        toolName,
        ok: execResult.ok,
        status: execResult.status,
        ...(undoLogId ? { undoLogId } : {}),
        preview,
        ...(RICH_PREVIEW_TOOLS.has(toolName) ? { data: execResult.result } : {}),
      };

      // Сохраняем tool-message в conversation.
      const toolMessage = await this.appendMessage({
        conversationId: conversation.id,
        role: 'tool',
        content: JSON.stringify({
          tool: toolName,
          ok: execResult.ok,
          status: execResult.status,
          result: execResult.result,
          errorMessage: execResult.errorMessage,
        }),
        toolCalls: [{ id: `call_${i}`, name: toolName, arguments: params }],
      });

      // Agents v2 Фаза B2 — PARALLEL shadow scoring уже стартовал выше.
      // Дождёмся его и запишем ConciergeStepScore (без throw — shadow).
      await this.finalizeShadowScoring({
        shadowScoring: shadowScoringPromise,
        conversationId: conversation.id,
        messageId: toolMessage.id,
        stepIndex: i,
        tenantId: input.tenantId,
        llmCandidate: { toolName, args: params },
        effectiveQuestion,
      });

      toolMessages = [
        ...toolMessages,
        {
          role: 'tool',
          content: `Результат tool ${toolName}: ok=${execResult.ok} status=${execResult.status}. ${preview}`,
        },
      ];

      if (!execResult.ok) {
        // На fail — даём LLM шанс объяснить пользователю, что не получилось.
        // Один retry в цикле и далее final.
      }
    }

    if (!finalText) {
      finalText =
        'Готово. Если нужно — уточните, что сделать дальше.';
    }

    const assistantMsg = await this.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: finalText,
      toolCalls: dialogResult
        ? {
            dialogLayer: {
              enabled: true,
              intent: dialogResult.intent,
              confidence: dialogResult.confidence,
              queriesCount: dialogResult.queries.length,
              cacheHit: false,
            },
            preRetrieval: {
              hits: totalHits,
              uniqueIds: uniqueIdsCount,
              queriesUsed: preHits.length,
            },
          }
        : undefined,
    });

    yield { type: 'message', text: finalText };
    yield { type: 'done', messageId: assistantMsg.id };

    // Bump lastMessageAt — defense-in-depth (С24): updateMany с tenantId.
    await this.prisma.conciergeConversation.updateMany({
      where: { id: conversation.id, tenantId: input.tenantId },
      data: { lastMessageAt: new Date() },
    });
  }

  // ──────────────────────────── private ────────────────────────────────

  /**
   * ТЗ 2026-05-27 Фаза 2: dialog-layer запускается только при включённом
   * флаге `CONCIERGE_DIALOG_LAYER_ENABLED` И при инджекте `DialogService`
   * (опциональный — старые unit-тесты передают `null`).
   *
   * `try/catch` на чтении геттера — защита от случаев, когда мок
   * `TypedConfigService` в тестах не предоставляет `concierge.*`.
   */
  private isDialogLayerEnabled(): boolean {
    try {
      return this.cfg.concierge.dialogLayerEnabled === true && this.dialog !== null;
    } catch (err) {
      // audit С23 (2026-05-29): раньше первый catch молча возвращал false —
      // если cfg в проде ломался, dialog-layer тихо отключался без алертов.
      // Логируем (warn — не error, т.к. не блокирует запрос) и инкрементим
      // counter `concierge_config_error_total{reason}` для Grafana-алерта.
      this.metrics.incConciergeConfigError?.({ reason: 'dialog_layer_enabled' });
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'concierge: не удалось прочитать cfg.concierge.dialogLayerEnabled — fallback=false',
      );
      return false;
    }
  }

  /**
   * E2 (мастер-ТЗ Волна 1, Кластер A) — мастер-флаг защиты от
   * prompt-injection. Concierge выполняет МУТИРУЮЩИЕ tools на основе
   * пользовательского сообщения, поэтому user-блок обязан идти в LLM
   * обёрнутым в маркеры данных. Defensive try/catch — в старых unit-тестах
   * cfg может быть mock без `aiFeatures`. Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  private async loadOrCreateConversation(
    input: ProcessInput,
  ): Promise<ConciergeConversation> {
    if (input.conversationId) {
      const existing = await this.prisma.conciergeConversation.findFirst({
        where: {
          id: input.conversationId,
          tenantId: input.tenantId,
          userId: input.userId,
        },
      });
      if (existing) return existing;
    }
    return this.prisma.conciergeConversation.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        pageContextJson: (input.pageContext ?? null) as unknown as Prisma.InputJsonValue,
        lastMessageAt: new Date(),
      },
    });
  }

  private async appendMessage(args: {
    conversationId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: unknown;
  }): Promise<ConciergeMessage> {
    return this.prisma.conciergeMessage.create({
      data: {
        conversationId: args.conversationId,
        role: args.role,
        content: args.content,
        toolCallsJson: args.toolCalls
          ? (args.toolCalls as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  }

  private async loadRecentHistory(
    conversationId: string,
    take: number,
  ): Promise<ConciergeMessage[]> {
    const messages = await this.prisma.conciergeMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return messages.reverse();
  }

  /**
   * ТЗ 2026-05-27 Фаза 5: делегирует pure-функции `buildSystemPrompt`
   * (module-level export). Имена совпадают — вызов через `this.` снимает
   * неоднозначность, локальный shadow не возникает.
   *
   * F1 cache-friendly (2026-06-10): SYSTEM больше не зависит от preHits —
   * предварительные результаты поиска подмешиваются в user-сообщение
   * (`composeUserMessageForIteration`), чтобы SYSTEM-префикс был стабилен
   * и кэшировался провайдером.
   *
   * Ф3 assistant-channels (2026-06-11): при `nativeTools=true` SYSTEM
   * собирается без JSON-инструкции и без toolFragment (tools уходят
   * провайдеру нативно через `LlmCallParams.tools`).
   */
  private buildSystemPrompt(contextBlock: string, nativeTools: boolean): string {
    return buildSystemPrompt({
      contextBlock,
      toolFragment: nativeTools
        ? ''
        : this.serviceMap.buildToolUsePromptFragment(),
      nativeTools,
    });
  }

  /**
   * Ф3 assistant-channels (2026-06-11) — kill-switch native function-calling.
   * Default true (Ship-On) живёт в `TypedConfigService.concierge` (ENV
   * `CONCIERGE_NATIVE_TOOLS_ENABLED`, пустое значение → true). Здесь —
   * строгая проверка `=== true`: моки cfg в старых unit-тестах без поля
   * остаются на legacy regex-пути; defensive try/catch — по образцу
   * `isDialogLayerEnabled` (cfg может сломаться в проде).
   */
  private isNativeToolsEnabled(): boolean {
    try {
      return this.cfg.concierge.nativeToolsEnabled === true;
    } catch (err) {
      this.metrics.incConciergeConfigError?.({ reason: 'other' });
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'concierge: не удалось прочитать cfg.concierge.nativeToolsEnabled — fallback=false (regex-эмуляция)',
      );
      return false;
    }
  }

  /**
   * Ф3 — приводит native tool_calls из ответа LLM к внутреннему формату
   * tool-loop'а (та же форма, что у `tryParseToolCall`). Берём ПЕРВЫЙ
   * tool_call — sequential: RU-провайдеры (DeepSeek/прокси/Ollama) не
   * гарантируют корректный parallel tool-use; остальные вызовы модель
   * перезапросит на следующей итерации по tool-результату. Если toolCalls
   * пуст — `out.text` это финальный ответ (как в legacy-пути).
   */
  private toolCallFromNativeOutput(
    out: Pick<LlmCallResult, 'text' | 'toolCalls'>,
  ):
    | { kind: 'tool_call'; toolName: string; params: Record<string, unknown> }
    | { kind: 'final'; text: string } {
    const first = out.toolCalls?.[0];
    if (!first) {
      return { kind: 'final', text: out.text.trim() };
    }
    // `input` приходит уже распарсенным объектом (см. LlmToolCall), но
    // defensively отбрасываем не-объекты (строка/массив/null) → {}.
    const params =
      typeof first.input === 'object' &&
      first.input !== null &&
      !Array.isArray(first.input)
        ? (first.input as Record<string, unknown>)
        : {};
    return { kind: 'tool_call', toolName: first.name, params };
  }

  /**
   * Парсит ответ LLM. Если есть `{"tool_call": ...}` JSON — возвращаем
   * tool_call info. Иначе — финальный текст.
   */
  private tryParseToolCall(text: string): {
    kind: 'tool_call';
    toolName: string;
    params: Record<string, unknown>;
  } | { kind: 'final'; text: string } {
    // Ищем JSON-объект с ключом tool_call. Терпимы к leading/trailing text.
    const match = text.match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
    if (!match) {
      return { kind: 'final', text: text.trim() };
    }
    try {
      const obj = JSON.parse(match[0]) as {
        tool_call?: { name?: string; arguments?: Record<string, unknown> };
      };
      const tc = obj.tool_call;
      if (!tc || typeof tc.name !== 'string') {
        return { kind: 'final', text: text.trim() };
      }
      return {
        kind: 'tool_call',
        toolName: tc.name,
        params: tc.arguments ?? {},
      };
    } catch {
      return { kind: 'final', text: text.trim() };
    }
  }

  private previewResult(result: unknown): string {
    if (result === null || result === undefined) return '(пусто)';
    try {
      const s = typeof result === 'string' ? result : JSON.stringify(result);
      return s.slice(0, 400);
    } catch {
      return '(нечитаемый ответ)';
    }
  }

  /**
   * ТЗ 2026-05-27 Фаза 3 — pre-retrieval.
   *
   * До первой LLM-итерации параллельно бьёт `search_knowledge` по
   * `dialogResult.queries[]`, дедуплицирует по `id` и обрезает Top-K.
   * Никаких записей в `ConciergeMessage`/`ConciergeUndoLog` — это служебный
   * вызов, нужен только чтобы подложить контекст в системный промпт.
   *
   * Skip для intent'ов не из {factual, exploratory, analytical} —
   * например `clone_roleplay` не нуждается в графовом поиске.
   */
  private async preRetrieve(args: {
    queries: string[];
    intent: DialogIntent;
    userId: string;
    tenantId: string;
    /** Ф5: опционален — в service-режиме ToolRouter резолвит loopbackBaseUrl. */
    baseUrl?: string;
    authMode?: 'cookie' | 'service';
    authCookie?: string;
  }): Promise<Array<{ query: string; result: unknown }>> {
    if (!['factual', 'exploratory', 'analytical'].includes(args.intent)) {
      return [];
    }
    const topK = this.cfg.concierge.preRetrievalTopK;
    const timeoutMs = this.cfg.concierge.preRetrievalTimeoutMs;

    const uniqueQueries = Array.from(
      new Set(args.queries.filter((q) => q.trim())),
    ).slice(0, 3);
    const results = await Promise.all(
      uniqueQueries.map(async (q) => {
        const exec = this.toolRouter.execute({
          toolName: 'search_knowledge',
          args: { q },
          userId: args.userId,
          tenantId: args.tenantId,
          ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
          ...(args.authMode ? { authMode: args.authMode } : {}),
          ...(args.authCookie ? { authCookie: args.authCookie } : {}),
        });
        const timeout = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs),
        );
        try {
          const out = await Promise.race([exec, timeout]);
          if (!out) return null;
          if (!out.ok) return null;
          return { query: q, result: out.result };
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err), query: q },
            'preRetrieve: search_knowledge failed',
          );
          return null;
        }
      }),
    );
    const hits = results.filter(
      (x): x is { query: string; result: unknown } => x !== null,
    );
    // Дедуп по id внутри result (если есть массив items).
    const seenIds = new Set<string>();
    const dedupHits: Array<{ query: string; result: unknown }> = [];
    for (const hit of hits) {
      const items = this.extractItems(hit.result);
      const filtered = items.filter((item) => {
        const id = this.extractId(item);
        if (id == null) return true;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });
      if (filtered.length > 0) {
        dedupHits.push({ query: hit.query, result: filtered });
      }
    }
    // Top-K cumulative.
    let total = 0;
    const capped: typeof dedupHits = [];
    for (const h of dedupHits) {
      const items = Array.isArray(h.result) ? h.result : [];
      if (total >= topK) break;
      const remaining = topK - total;
      const slice = items.slice(0, remaining);
      capped.push({ query: h.query, result: slice });
      total += slice.length;
    }
    return capped;
  }

  private extractItems(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.results)) return obj.results;
      if (Array.isArray(obj.data)) return obj.data;
    }
    return [];
  }

  private extractId(item: unknown): string | null {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.id === 'string') return obj.id;
      if (typeof obj.id === 'number') return String(obj.id);
    }
    return null;
  }

  private tenantTop(tenantId: string): string {
    let h = 0;
    for (let i = 0; i < tenantId.length; i++) {
      h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
    }
    return `bucket_${(h % 100).toString().padStart(2, '0')}`;
  }

  // ─────────────── Agents v2 Фаза B2 — PRM step-scorer (shadow) ────────

  /**
   * Запускает shadow scoring параллельно с execution. Возвращает promise,
   * который никогда не throws — внутри try/catch + logger.warn. Если фича
   * выключена (флаг / отсутствует stepScorer / не повезло с sampleRate) —
   * сразу возвращает `null`.
   *
   * Top-K diversity: дополнительные K-1 LLM-вызовов с тем же промптом.
   * Provider должен дать разные результаты при `temperature > 0`. Если
   * provider детерминистский — дубликаты будут отфильтрованы по
   * `(toolName, hash(args))`; в худшем случае scoring произойдёт только
   * по LLM-выбору (K=1) — это допустимо для shadow.
   */
  private maybeStartShadowScoring(args: {
    llmCandidate: StepCandidate;
    systemPrompt: string;
    userMessage: string;
    tenantId: string;
    userId: string;
    effectiveQuestion: string;
    history: ConciergeMessage[];
    preHits: Array<{ query: string; result: unknown }>;
  }): Promise<StepScore[] | null> {
    if (!this.isPrmShadowEnabled()) return Promise.resolve(null);
    if (!this.stepScorer) return Promise.resolve(null);

    // Cost-защита: запускаем shadow только для каждого Nth вызова.
    let sampleRate: number;
    try {
      sampleRate = this.cfg.concierge.prmShadowSampleRate;
    } catch {
      sampleRate = 1.0;
    }
    if (sampleRate < 1 && Math.random() > sampleRate) {
      return Promise.resolve(null);
    }

    let topK: number;
    try {
      topK = Math.max(1, this.cfg.concierge.prmTopK);
    } catch {
      topK = 3;
    }

    const scorer = this.stepScorer;
    return (async () => {
      try {
        // Соберём top-K кандидатов: первый — LLM choice; остальные K-1 — доп.
        // вызовы того же промпта (provider должен дать diverse результаты при
        // temperature > 0). LlmRouterService.call() не принимает temperature
        // напрямую — diversity обеспечивает provider default (>0 для
        // deepseek-chat/openai). Если provider детерминистский — duplicates
        // отфильтруем ниже.
        const candidates: StepCandidate[] = [args.llmCandidate];
        const extraNeeded = Math.max(0, topK - 1);
        if (extraNeeded > 0) {
          const extras = await Promise.all(
            Array.from({ length: extraNeeded }, () =>
              this.generateAlternativeCandidate({
                systemPrompt: args.systemPrompt,
                userMessage: args.userMessage,
                tenantId: args.tenantId,
                userId: args.userId,
              }).catch(() => null),
            ),
          );
          for (const cand of extras) {
            if (!cand) continue;
            const dup = candidates.some(
              (c) =>
                c.toolName === cand.toolName &&
                this.stableArgsHash(c.args) === this.stableArgsHash(cand.args),
            );
            if (!dup) candidates.push(cand);
          }
        }

        const scores = await scorer.scoreAllCandidates({
          goal: args.effectiveQuestion,
          history: args.history,
          retrievedContext: args.preHits,
          candidates,
          tenantId: args.tenantId,
        });
        return scores;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'concierge PRM shadow scoring failed (non-fatal)',
        );
        return null;
      }
    })();
  }

  /**
   * Финализирует shadow scoring: дожидается результата, считает ранги
   * относительно PRM-сортировки и записывает `ConciergeStepScore`.
   * Метод никогда не throws — все ошибки логируются как warn.
   */
  private async finalizeShadowScoring(args: {
    shadowScoring: Promise<StepScore[] | null>;
    conversationId: string;
    messageId: string;
    stepIndex: number;
    tenantId: string;
    llmCandidate: StepCandidate;
    effectiveQuestion: string;
  }): Promise<void> {
    let scores: StepScore[] | null;
    try {
      scores = await args.shadowScoring;
    } catch {
      scores = null;
    }
    if (!scores || scores.length === 0) return;

    try {
      // Сортируем по убыванию score → определяем top-1 PRM.
      const sorted = [...scores].sort((a, b) => b.score - a.score);
      const llmHash = this.stableArgsHash(args.llmCandidate.args);
      const selectedRank =
        sorted.findIndex(
          (s) =>
            s.candidate.toolName === args.llmCandidate.toolName &&
            this.stableArgsHash(s.candidate.args) === llmHash,
        ) + 1; // 1-based; 0 → not found → +1 = 1 (fallback)
      const effectiveRank = selectedRank === 0 ? 1 : selectedRank;
      const selectedEntry =
        sorted.find(
          (s) =>
            s.candidate.toolName === args.llmCandidate.toolName &&
            this.stableArgsHash(s.candidate.args) === llmHash,
        ) ?? sorted[0]!;
      const topPrm = sorted[0]!;
      const prmAgreed =
        topPrm.candidate.toolName === args.llmCandidate.toolName &&
        this.stableArgsHash(topPrm.candidate.args) === llmHash;

      // Метрики (никогда не throws — Optional metrics).
      this.metrics.incConciergePrmAgreement?.({
        agreed: prmAgreed ? 'true' : 'false',
      });
      const rankLabel: '1' | '2' | '3' | 'other' =
        effectiveRank === 1
          ? '1'
          : effectiveRank === 2
            ? '2'
            : effectiveRank === 3
              ? '3'
              : 'other';
      this.metrics.incConciergePrmLlmRank?.({ rank: rankLabel });
      for (const s of sorted) {
        this.metrics.observeConciergePrmScore?.({
          toolName: s.candidate.toolName,
          score: s.score,
        });
      }

      await this.prisma.conciergeStepScore.create({
        data: {
          tenantId: args.tenantId,
          conversationId: args.conversationId,
          messageId: args.messageId,
          stepIndex: args.stepIndex,
          goalSummary: args.effectiveQuestion.slice(0, 500),
          selectedTool: {
            toolName: args.llmCandidate.toolName,
            args: args.llmCandidate.args,
          } as unknown as Prisma.InputJsonValue,
          alternatives: sorted.map((s) => ({
            toolName: s.candidate.toolName,
            args: s.candidate.args,
            score: s.score,
            reasoning: s.reasoning,
          })) as unknown as Prisma.InputJsonValue,
          selectedScore: selectedEntry.score,
          selectedRank: effectiveRank,
          // В фазе B всегда совпадает с selectedRank (см. поле в schema.prisma).
          llmChoseRank: effectiveRank,
          prmAgreed,
          promotedToActive: false,
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          conversationId: args.conversationId,
        },
        'concierge PRM: запись ConciergeStepScore упала (shadow no-op)',
      );
    }
  }

  /**
   * Дополнительный LLM-вызов с тем же промптом, что и основной concierge-respond.
   * Используется только при `prmShadowEnabled=true`. Парсит ответ как tool_call;
   * если LLM вернул final-текст — возвращает null (нет альтернативного tool).
   */
  private async generateAlternativeCandidate(args: {
    systemPrompt: string;
    userMessage: string;
    tenantId: string;
    userId: string;
  }): Promise<StepCandidate | null> {
    const out = await this.llm.call({
      taskType: 'concierge-respond',
      systemPrompt: args.systemPrompt,
      userMessage: args.userMessage,
      tenantId: args.tenantId,
      userId: args.userId,
      maxTokens: 1500,
    });
    const parsed = this.tryParseToolCall(out.text);
    if (parsed.kind !== 'tool_call') return null;
    return { toolName: parsed.toolName, args: parsed.params };
  }

  private isPrmShadowEnabled(): boolean {
    try {
      return this.cfg.concierge.prmShadowEnabled === true;
    } catch {
      this.metrics.incConciergeConfigError?.({ reason: 'other' });
      return false;
    }
  }

  /**
   * Стабильный хеш args для сравнения «тот же tool_call?». Использует
   * отсортированный по ключам JSON.stringify — порядок ключей не должен
   * влиять на сравнение.
   */
  private stableArgsHash(args: Record<string, unknown>): string {
    try {
      const sorted = Object.keys(args)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = args[k];
          return acc;
        }, {});
      return JSON.stringify(sorted);
    } catch {
      return '{}';
    }
  }
}
