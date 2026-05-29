import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ConciergeConversation,
  type ConciergeMessage,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  DialogService,
  type DialogProcessResult,
} from '../../dialog-layer/services/dialog.service';
import type { DialogIntent } from '../../dialog-layer/services/query-classifier.service';
import type { PageContextDto } from '../dto/concierge.dto';

import { ConciergeContextBuilderService } from './concierge-context-builder.service';
import { ConciergeQuotaService } from './concierge-quota.service';
import { ConciergeUndoLogService } from './concierge-undo-log.service';
import { ServiceMapGeneratorService } from './service-map-generator.service';
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
  baseUrl: string;
  authCookie?: string;
}

/**
 * Pure helper: собирает «user message» для одной итерации tool-loop.
 *
 * Экспортируется отдельно от класса, чтобы покрыть unit-тестами без
 * необходимости поднимать NestJS DI / PrismaService.
 *
 * Структура output (в порядке появления):
 *   1. `КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:` + summary (если задан)
 *   2. `История диалога:` + последние N сообщений (если есть)
 *   3. `Результаты последних tool вызовов:` (если есть)
 *   4. `Новый запрос пользователя: <userMessage>`
 */
/**
 * Pure helper (ТЗ 2026-05-27 Фаза 5): собирает системный промпт.
 *
 * Вынесен из метода класса, чтобы покрыть snapshot-тестами без поднятия
 * NestJS DI. `toolFragment` передаётся параметром (раньше брался через
 * `this.serviceMap.buildToolUsePromptFragment()`).
 *
 * Структура output (в порядке появления):
 *   1. Преамбула (роль ассистента).
 *   2. `=== КОНТЕКСТ ===` + contextBlock (или fallback).
 *   3. (опц.) `=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===` если `preHits.length > 0`.
 *   4. `=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===` + tool-use инструкции + toolFragment.
 *   5. Принципы.
 */
export function buildSystemPrompt(args: {
  contextBlock: string;
  toolFragment: string;
  preHits: Array<{ query: string; result: unknown }>;
}): string {
  const parts: string[] = [
    'Ты — Concierge, AI-помощник в кабинете компании Z (Кора).',
    'Отвечай по-русски, кратко и по делу.',
    '',
    '=== КОНТЕКСТ ===',
    args.contextBlock || '(контекст недоступен)',
    '',
  ];
  // ТЗ 2026-05-27 Фаза 3: блок предварительных результатов pre-retrieval.
  if (args.preHits.length > 0) {
    parts.push('=== ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===');
    parts.push(
      'Вот что нашлось в графе компании по этому вопросу. Если этого достаточно — отвечай по этим данным без дополнительных вызовов. Если данных мало — ты можешь вызвать search_knowledge сам.',
    );
    parts.push('');
    parts.push(JSON.stringify(args.preHits, null, 2));
    parts.push('');
  }
  parts.push(
    '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
    'Если запрос требует действия — верни ОДНУ строку строго в формате JSON:',
    '{"tool_call": {"name": "<имя>", "arguments": { ... }}}',
    'Если действие не требуется — верни просто текст ответа без JSON.',
    'Имя инструмента ДОЛЖНО быть из списка ниже:',
    args.toolFragment,
    '',
    'Принципы:',
    '- Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.',
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
    }
  | { type: 'message'; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'quota_exceeded'; scope: 'daily' | 'monthly' };

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

    // Quota check.
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
          baseUrl: input.baseUrl,
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

    const systemPrompt = this.buildSystemPrompt(contextBlock, preHits);
    const history = await this.loadRecentHistory(conversation.id, K_RECENT_MESSAGES);

    // Tool-use loop (эмулируется через JSON в ответе LLM).
    let toolMessages: Array<{ role: 'tool'; content: string }> = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      const userBlock = composeUserMessageForIteration({
        userMessage: effectiveQuestion,
        toolMessages,
        history,
        summary: conversation.summary,
      });

      let llmText: string;
      try {
        const out = await this.llm.call({
          taskType: 'concierge-respond',
          systemPrompt,
          userMessage: userBlock,
          tenantId: input.tenantId,
          userId: input.userId,
          maxTokens: 1500,
        });
        llmText = out.text;
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

      const parsed = this.tryParseToolCall(llmText);
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

      // Execute через ToolRouter.
      const execResult = await this.toolRouter.execute({
        toolName,
        args: params,
        userId: input.userId,
        tenantId: input.tenantId,
        baseUrl: input.baseUrl,
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
      };

      // Сохраняем tool-message в conversation.
      await this.appendMessage({
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
   */
  private buildSystemPrompt(
    contextBlock: string,
    preHits: Array<{ query: string; result: unknown }> = [],
  ): string {
    return buildSystemPrompt({
      contextBlock,
      toolFragment: this.serviceMap.buildToolUsePromptFragment(),
      preHits,
    });
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
    baseUrl: string;
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
          baseUrl: args.baseUrl,
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
}
