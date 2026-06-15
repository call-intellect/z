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
import { QuotaExceededError } from '../../quotas/quota.errors';
import type { PageContextDto } from '../dto/concierge.dto';
import {
  CONCIERGE_RESPOND_SYSTEM_PROMPT,
  buildConciergeUserPrompt,
} from '../prompts/concierge-respond.prompt';

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

/**
 * ТЗ 2026-06-14 — дефолты крутилок помощника (AdminSetting / getDynamic).
 * Дублируют значения seed-скрипта `seed-admin-setting-concierge.ts`; служат
 * code-fallback'ом, если AdminSetting не отвечает (а также в unit-тестах с
 * cfg-моком без `getDynamic`).
 */
const DEFAULT_HISTORY_PAIRS = 4;
const DEFAULT_CLARIFY_MIN_CONFIDENCE = 80;

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
  /**
   * Ф6 assistant-channels (2026-06-11) — канальный whitelist инструментов.
   * Если задан — помощник ВИДИТ (native tools / legacy toolFragment) и может
   * ИСПОЛНЯТЬ только перечисленные инструменты; выбор вне списка не
   * исполняется (в toolMessages кладётся отказ, модель переформулирует).
   * `undefined` — все инструменты (web-чат, поведение не меняется).
   * RBAC-гейт ToolRouter'а остаётся в силе — это двойная защита.
   */
  toolWhitelist?: string[];
  /**
   * Ф6 assistant-channels (2026-06-11) — текстовое подтверждение мутаций
   * (zero-button, В6). `true` (каналы Telegram/MAX): мутирующий инструмент
   * без `undoableVia` НЕ исполняется — генератор отдаёт событие
   * `confirm_required` (+`done`) и завершается; подтверждение разруливает
   * мост (AssistantChannelBridge). Default `false` — web-SSE путь прежний.
   */
  confirmHold?: boolean;
}

/**
 * ТЗ 2026-06-14 (assistant-router-dedup) — системный промпт помощника
 * вынесен в `prompts/concierge-respond.prompt.ts`
 * (`CONCIERGE_RESPOND_SYSTEM_PROMPT`), сборка user-блока — в
 * `buildConciergeUserPrompt`. Прежние module-level `buildSystemPrompt` /
 * `composeUserMessageForIteration` (с легаси-JSON-инструкцией и предпоиском)
 * удалены вместе с понимаем/предпоиском в помощнике.
 */

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
  | {
      /**
       * Ф6 assistant-channels (2026-06-11) — текстовое подтверждение мутаций.
       * Эмитится ТОЛЬКО при `ProcessInput.confirmHold=true`: выбранный
       * инструмент мутирующий и без `undoableVia` — исполнение отложено до
       * явного «да» пользователя (разруливает мост канала). После этого
       * события генератор отдаёт `done` и завершается.
       */
      type: 'confirm_required';
      toolName: string;
      params: Record<string, unknown>;
      /** Человекочитаемое превью: русское название действия + ключевые параметры. */
      preview: string;
    }
  | {
      type: 'message';
      text: string;
      /**
       * ТЗ 2026-06-14 — цитаты chat-v2 при терминальном (passthrough)
       * `ask_chat_v2`: ответ из памяти отдаётся напрямую с источниками.
       * Присутствует только когда turn = чистый вопрос к памяти.
       */
      citations?: unknown[];
    }
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

/**
 * Ф6 assistant-channels (2026-06-11) — русские названия инструментов для
 * человекочитаемого превью в текстовом подтверждении («Подтвердите действие:
 * …»). Покрывает мутирующие инструменты реестра; неизвестное имя — fallback
 * на сам toolName. Только русский текст в превью (UI-правило проекта).
 */
const CONFIRM_TOOL_RU_NAMES: Record<string, string> = {
  create_meeting: 'создать встречу',
  cancel_meeting: 'отменить встречу',
  create_event: 'создать событие в календаре',
  delete_event: 'отменить событие в календаре',
  ask_chat_v2: 'задать вопрос AI-чату компании',
  ask_role_clone: 'спросить клон должности',
  find_free_slot: 'найти общий свободный слот',
  infer_table_schema: 'предложить схему новой таблицы',
};

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
     * Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow).
     * `@Optional()` — фича включается флагом `CONCIERGE_PRM_SHADOW_ENABLED`
     * (default false). Существующие unit-тесты, мокающие конструктор без
     * последнего аргумента, остаются совместимыми.
     *
     * ТЗ 2026-06-14 (assistant-router-dedup) — инъекция `DialogService`
     * УБРАНА: помощник больше не владеет пониманием запроса (нет
     * `dialog.process()`/предпоиска). Понимание-цепочка и синтез считаются
     * один раз внутри chat-v2 (терминальный `ask_chat_v2`).
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

    // ТЗ 2026-06-14 (assistant-router-dedup) — помощник БОЛЬШЕ НЕ
    // контекстуализирует и не ищет заранее. Понимание-цепочка и синтез
    // считаются один раз внутри chat-v2 (терминальный `ask_chat_v2`).
    // Ушли: `dialog.process()`, предпоиск (`preRetrieve`), preHits, cache-
    // short-circuit, метрики dialog-layer/pre-retrieval. Запрос идёт в LLM
    // как есть.
    const effectiveQuestion = input.userMessage;

    // ТЗ 2026-06-14 — порог самооценки понимания (крутилка AdminSetting).
    // Читаем для будущего тюнинга/возможной передачи в контекст; жёсткий
    // numeric-gate НЕ строим (уточнение управляется промптом, Приложение A,
    // + валидацией required-параметров в ToolRouter).
    const clarifyMinConfidence = await this.getClarifyMinConfidence();
    this.logger.debug(
      {
        feature: 'concierge',
        stage: 'clarify-threshold',
        clarifyMinConfidence,
        conversationId: conversation.id,
      },
      'concierge clarify threshold loaded',
    );

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
    // Ф6 — канальный whitelist: если задан, провайдер видит только сужённый
    // набор (native) / сужённый toolFragment (legacy). undefined → все tools.
    const llmTools = nativeTools
      ? this.serviceMap.toLlmTools(input.toolWhitelist)
      : [];

    // ТЗ 2026-06-14 — SYSTEM = стабильный промпт помощника (Приложение A).
    // Cache-friendly: SYSTEM не зависит от запроса (provider кэширует
    // префикс ≈99%). Все переменные (контекст пользователя / summary /
    // история / сообщение) едут в КОНЦЕ user-блока. Native (прод-дефолт):
    // tools уходят провайдеру отдельно (`LlmCallParams.tools`), SYSTEM —
    // ровно константа. Legacy regex-путь (kill-switch OFF): дописываем
    // JSON-инструкцию `{"tool_call"}` + список инструментов (иначе модель не
    // знает, как звать инструмент). Это OFF-ветка — кэш на ней не критичен.
    const rawSystemPrompt = nativeTools
      ? CONCIERGE_RESPOND_SYSTEM_PROMPT
      : [
          CONCIERGE_RESPOND_SYSTEM_PROMPT,
          '',
          '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
          'Если нужно действие или данные — верни ОДНУ строку строго в формате JSON:',
          '{"tool_call": {"name": "<имя>", "arguments": { ... }}}',
          'Если инструмент не нужен — верни просто текст ответа без JSON.',
          'Имя инструмента ДОЛЖНО быть из списка ниже:',
          this.serviceMap.buildToolUsePromptFragment(input.toolWhitelist),
        ].join('\n');

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
    // История — 4 пары (8 сообщений) через крутилку `concierge.history_pairs`.
    const historyTake = await this.getHistoryMessagesCount();
    const history = await this.loadRecentHistory(conversation.id, historyTake);

    // ТЗ 2026-06-14 — passthrough ask_chat_v2: считаем имена инструментов,
    // исполненных за turn. Если за весь turn исполнен РОВНО один инструмент и
    // это успешный `ask_chat_v2` (вопрос к памяти) — итоговый ответ помощника
    // = захваченный ответ chat-v2 (текст + цитаты) напрямую, без второго
    // синтеза. Смешанный turn (ask_chat_v2 + действие) → модель финализирует.
    const executedTools: string[] = [];
    let askChatV2Capture: { text: string; citations: unknown[] } | null = null;

    // Tool-use loop (эмулируется через JSON в ответе LLM).
    let toolMessages: Array<{ role: 'tool'; content: string }> = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      // ТЗ 2026-06-14 — user-блок по Приложению A: контекст пользователя
      // (per-request, поэтому в user) + summary + последние пары + сообщение.
      // Результаты исполненных инструментов прокидываем тем же помощником как
      // дополнительный блок (модель финализирует поверх них).
      const rawUserBlock = this.composeConciergeUserBlock({
        contextBlock,
        summary: conversation.summary,
        history,
        toolMessages,
        message: effectiveQuestion,
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

      // Ф6 — защита исполнения по канальному whitelist'у: даже если модель
      // выбрала инструмент вне сужённого списка (галлюцинация / инъекция),
      // НЕ исполняем. Кладём отказ в toolMessages и идём на следующую
      // итерацию — модель переформулирует. RBAC-гейт ToolRouter ниже
      // остаётся как был (двойная защита).
      if (input.toolWhitelist && !input.toolWhitelist.includes(toolName)) {
        this.logger.warn(
          { toolName, conversationId: conversation.id },
          'concierge: tool вне канального whitelist — исполнение отклонено',
        );
        toolMessages = [
          ...toolMessages,
          {
            role: 'tool',
            content: `Результат tool ${toolName}: ok=false status=403. Инструмент недоступен в этом канале — выбери другой инструмент из списка или ответь текстом.`,
          },
        ];
        continue;
      }

      const tool = this.serviceMap.findTool(toolName);
      // readOnly — семантически безопасный POST (чистый расчёт / «задать
      // вопрос»): confirm не нужен, см. ToolSchema.readOnly.
      const requiresConfirm =
        !!tool &&
        tool.method !== 'GET' &&
        !tool.readOnly &&
        !tool.undoableVia;

      // Ф6 — текстовое подтверждение мутаций (zero-button, В6): в канальном
      // режиме (confirmHold=true) мутирующий инструмент без undoableVia НЕ
      // исполняется. Отдаём confirm_required (мост сохранит состояние в Redis
      // и спросит «да»/«нет»), пишем assistant-сообщение с вопросом (история
      // диалога остаётся связной) и корректно завершаем поток через done.
      if (input.confirmHold === true && requiresConfirm) {
        const confirmPreview = this.buildConfirmPreview(toolName, params);
        yield {
          type: 'confirm_required',
          toolName,
          params,
          preview: confirmPreview,
        };
        const holdMsg = await this.appendMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: `Подтвердите действие: ${confirmPreview}`,
          toolCalls: [
            { id: `confirm_${i}`, name: toolName, arguments: params, held: true },
          ],
        });
        yield { type: 'done', messageId: holdMsg.id };
        // Bump lastMessageAt — как в основном финале (С24: updateMany+tenantId).
        await this.prisma.conciergeConversation.updateMany({
          where: { id: conversation.id, tenantId: input.tenantId },
          data: { lastMessageAt: new Date() },
        });
        return;
      }

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
        // ТЗ 2026-06-14 — предпоиск убран; PRM-скореру отдаём пустой контекст.
        preHits: [],
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

      // ТЗ 2026-06-14 — учёт исполненных инструментов для passthrough
      // ask_chat_v2. Захватываем текст+цитаты успешного chat-v2 (вопрос к
      // памяти). Решение «отдать напрямую» принимается ПОСЛЕ цикла — только
      // если ask_chat_v2 был ЕДИНСТВЕННЫМ исполненным инструментом за turn.
      executedTools.push(toolName);
      if (toolName === 'ask_chat_v2' && execResult.ok) {
        askChatV2Capture = this.extractChatV2Answer(execResult.result);
      }

      let undoLogId: string | undefined;
      // readOnly-инструменты в undo-log не пишутся — откатывать нечего.
      if (execResult.ok && tool && tool.method !== 'GET' && !tool.readOnly) {
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

    // ТЗ 2026-06-14 — терминальный ask_chat_v2 (passthrough). Если за весь
    // turn исполнен РОВНО один инструмент и это успешный `ask_chat_v2`
    // (чистый вопрос к памяти) — итоговый ответ помощника = ответ chat-v2
    // (текст + цитаты) НАПРЯМУЮ, без второго синтеза. Смешанный turn
    // («узнать → сделать») сюда не попадает: executedTools.length > 1 →
    // финализирует модель. Не глотаем ответ, если за ask_chat_v2 следовало
    // действие.
    let citations: unknown[] = [];
    const passthrough =
      executedTools.length === 1 &&
      executedTools[0] === 'ask_chat_v2' &&
      askChatV2Capture !== null;
    if (passthrough && askChatV2Capture) {
      finalText = askChatV2Capture.text;
      citations = askChatV2Capture.citations;
    }

    if (!finalText) {
      finalText = 'Готово. Если нужно — уточните, что сделать дальше.';
    }

    const assistantMsg = await this.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: finalText,
      ...(passthrough
        ? {
            toolCalls: {
              askChatV2Passthrough: true,
              citationsCount: citations.length,
            },
          }
        : {}),
    });

    yield {
      type: 'message',
      text: finalText,
      ...(citations.length > 0 ? { citations } : {}),
    };
    yield { type: 'done', messageId: assistantMsg.id };

    // Bump lastMessageAt — defense-in-depth (С24): updateMany с tenantId.
    await this.prisma.conciergeConversation.updateMany({
      where: { id: conversation.id, tenantId: input.tenantId },
      data: { lastMessageAt: new Date() },
    });
  }

  // ──────────────────────────── private ────────────────────────────────

  /**
   * ТЗ 2026-06-14 — глубина истории диалога: крутилка `concierge.history_pairs`
   * (AdminSetting, дефолт 4 пары). Возвращает количество СООБЩЕНИЙ (= пары×2).
   * Defensive try/catch — в unit-тестах cfg-мок может не иметь `getDynamic`.
   */
  private async getHistoryMessagesCount(): Promise<number> {
    let pairs: number;
    try {
      pairs = await this.cfg.getDynamic<number>(
        'concierge.history_pairs',
        undefined,
        DEFAULT_HISTORY_PAIRS,
      );
    } catch {
      pairs = DEFAULT_HISTORY_PAIRS;
    }
    const safePairs = Number.isFinite(pairs) && pairs > 0 ? pairs : DEFAULT_HISTORY_PAIRS;
    return safePairs * 2;
  }

  /**
   * ТЗ 2026-06-14 — порог самооценки понимания (0–100), крутилка
   * `concierge.clarify_min_confidence` (AdminSetting, дефолт 80 — с креном в
   * вопрос). Читается для будущего тюнинга/возможной передачи в контекст;
   * ЖЁСТКИЙ numeric-gate в коде НЕ строится (уточнение управляется промптом
   * Приложения A + валидацией required-параметров в ToolRouter). Defensive
   * try/catch — cfg-мок в тестах может не иметь `getDynamic`.
   */
  private async getClarifyMinConfidence(): Promise<number> {
    try {
      return await this.cfg.getDynamic<number>(
        'concierge.clarify_min_confidence',
        undefined,
        DEFAULT_CLARIFY_MIN_CONFIDENCE,
      );
    } catch {
      return DEFAULT_CLARIFY_MIN_CONFIDENCE;
    }
  }

  /**
   * ТЗ 2026-06-14 — сборка user-блока помощника. Контекст пользователя
   * (per-request, поэтому в user — SYSTEM остаётся стабильным/кэшируемым) +
   * Приложение A (summary / последние пары / сообщение). Результаты
   * исполненных за turn инструментов подмешиваются отдельным блоком, чтобы
   * модель финализировала поверх них.
   */
  private composeConciergeUserBlock(args: {
    contextBlock: string;
    summary: string | null;
    history: Array<Pick<ConciergeMessage, 'role' | 'content'>>;
    toolMessages: Array<{ role: 'tool'; content: string }>;
    message: string;
  }): string {
    const parts: string[] = [];
    if (args.contextBlock.trim() !== '') {
      parts.push('Контекст:');
      parts.push(args.contextBlock);
      parts.push('');
    }
    parts.push(
      buildConciergeUserPrompt({
        summary: args.summary,
        recentMessages: args.history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        message: args.message,
      }),
    );
    if (args.toolMessages.length > 0) {
      parts.push('');
      parts.push('Результаты последних вызовов инструментов:');
      for (const tm of args.toolMessages) {
        parts.push(`- ${tm.content}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * ТЗ 2026-06-14 — извлекает текст+цитаты из результата `ask_chat_v2`
   * (`POST /api/v1/chat-v2/messages` → `{ text, citations, ... }`). Терпим к
   * форме: если поля нет — пустые значения. Используется для passthrough
   * (терминальный ask_chat_v2 на чистом вопросе к памяти).
   */
  private extractChatV2Answer(
    result: unknown,
  ): { text: string; citations: unknown[] } {
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const text = typeof obj.text === 'string' ? obj.text : '';
      const citations = Array.isArray(obj.citations) ? obj.citations : [];
      return { text, citations };
    }
    return { text: '', citations: [] };
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
   * Ф6 — человекочитаемое превью отложенного действия для текстового
   * подтверждения: русское название инструмента + до 3 ключевых параметров.
   * Используется в событии `confirm_required` и в assistant-сообщении
   * «Подтвердите действие: …».
   */
  private buildConfirmPreview(
    toolName: string,
    params: Record<string, unknown>,
  ): string {
    const ruName = CONFIRM_TOOL_RU_NAMES[toolName] ?? toolName;
    const keyParams = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .slice(0, 3)
      .map(([k, v]) => {
        let s: string;
        if (typeof v === 'string') {
          s = v;
        } else {
          try {
            s = JSON.stringify(v);
          } catch {
            s = String(v);
          }
        }
        return `${k}: ${s.slice(0, 80)}`;
      });
    return keyParams.length > 0
      ? `${ruName} (${keyParams.join(', ')})`
      : ruName;
  }

  /**
   * Ф3 assistant-channels (2026-06-11) — kill-switch native function-calling.
   * Default true (Ship-On) живёт в `TypedConfigService.concierge` (ENV
   * `CONCIERGE_NATIVE_TOOLS_ENABLED`, пустое значение → true). Здесь —
   * строгая проверка `=== true`: моки cfg в старых unit-тестах без поля
   * остаются на legacy regex-пути; defensive try/catch (cfg может сломаться
   * в проде).
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
