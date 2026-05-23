import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ConciergeConversation,
  type ConciergeMessage,
  Prisma,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';

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

export interface ProcessInput {
  userMessage: string;
  conversationId?: string | null;
  pageContext?: PageContextDto | null;
  userId: string;
  tenantId: string;
  baseUrl: string;
  authCookie?: string;
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
    let conversation = await this.loadOrCreateConversation(input);
    yield { type: 'started', conversationId: conversation.id };

    // Save user message.
    await this.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: input.userMessage,
    });

    // Build context.
    const contextBlock = await this.contextBuilder.build({
      tenantId: input.tenantId,
      userId: input.userId,
      pageContext: input.pageContext ?? null,
    });

    const systemPrompt = this.buildSystemPrompt(contextBlock);
    const history = await this.loadRecentHistory(conversation.id, 8);

    // Tool-use loop (эмулируется через JSON в ответе LLM).
    let toolMessages: Array<{ role: 'tool'; content: string }> = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      const userBlock = this.composeUserMessageForIteration({
        userMessage: input.userMessage,
        toolMessages,
        history,
      });

      let llmText = '';
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
    });

    yield { type: 'message', text: finalText };
    yield { type: 'done', messageId: assistantMsg.id };

    // Bump lastMessageAt.
    await this.prisma.conciergeConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // ──────────────────────────── private ────────────────────────────────

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

  private buildSystemPrompt(contextBlock: string): string {
    const toolFragment = this.serviceMap.buildToolUsePromptFragment();
    return [
      'Ты — Concierge, AI-помощник в кабинете компании Z (Кора).',
      'Отвечай по-русски, кратко и по делу.',
      '',
      '=== КОНТЕКСТ ===',
      contextBlock || '(контекст недоступен)',
      '',
      '=== ДОСТУПНЫЕ ИНСТРУМЕНТЫ ===',
      'Если запрос требует действия — верни ОДНУ строку строго в формате JSON:',
      '{"tool_call": {"name": "<имя>", "arguments": { ... }}}',
      'Если действие не требуется — верни просто текст ответа без JSON.',
      'Имя инструмента ДОЛЖНО быть из списка ниже:',
      toolFragment,
      '',
      'Принципы:',
      '- Никогда не выдумывай данные. Если не знаешь — используй search_knowledge или ask_chat_v2.',
      '- Для создания/изменения ресурсов — предпочитай tools с undoableVia (их можно отменить).',
      '- Если необходимо подтверждение пользователя — добавь в текст ответа явный вопрос.',
    ].join('\n');
  }

  private composeUserMessageForIteration(args: {
    userMessage: string;
    toolMessages: Array<{ role: 'tool'; content: string }>;
    history: ConciergeMessage[];
  }): string {
    const parts: string[] = [];
    if (args.history.length > 0) {
      parts.push('История диалога:');
      for (const m of args.history) {
        const role = m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'Ассистент' : 'Tool';
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
}
