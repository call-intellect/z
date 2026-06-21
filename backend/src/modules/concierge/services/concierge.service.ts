import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type ConciergeConversation, type ConciergeMessage, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { formatRuDate } from '../../../common/utils/format-ru-date';
import { AiChatQuotaService } from '../../ai-chat-quota/ai-chat-quota.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import { LlmRouterService, type LlmCallResult } from '../../ai/services/llm-router.service';
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

const MAX_TOOL_LOOP_ITERATIONS = 5;

const DEFAULT_HISTORY_PAIRS = 4;
const DEFAULT_CLARIFY_MIN_CONFIDENCE = 80;

export interface ProcessInput {
  userMessage: string;
  conversationId?: string | null;
  pageContext?: PageContextDto | null;
  userId: string;
  tenantId: string;
  baseUrl?: string;
  authCookie?: string;
  authMode?: 'cookie' | 'service';
  toolWhitelist?: string[];
  confirmHold?: boolean;
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
      data?: unknown;
    }
  | {
      type: 'confirm_required';
      toolName: string;
      params: Record<string, unknown>;
      preview: string;
    }
  | {
      type: 'message';
      text: string;
      citations?: unknown[];
    }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'quota_exceeded';
      scope: 'user_daily' | 'daily' | 'monthly';
      retryAfterSeconds?: number;
    };

const RICH_PREVIEW_TOOLS = new Set<string>(['infer_table_schema']);

const CONFIRM_TOOL_RU_NAMES: Record<string, string> = {
  create_meeting: 'создать встречу',
  cancel_meeting: 'отменить встречу',
  create_event: 'создать событие в календаре',
  delete_event: 'отменить событие в календаре',
  ask_chat_v2: 'задать вопрос AI-чату компании',
  ask_role_clone: 'спросить клон должности',
  find_free_slot: 'найти общий свободный слот',
  infer_table_schema: 'предложить схему новой таблицы',
  create_task: 'поставить задачу себе',
  assign_task: 'поставить задачу сотруднику',
};

const PARAM_RU_LABELS: Record<string, string> = {
  title: 'задача',
  description: 'детали',
  dueDate: 'срок',
  assigneeName: 'кому',
  question: 'вопрос',
  text: 'текст',
  type: 'тип',
  startAt: 'начало',
  endAt: 'конец',
  kind: 'вид',
  location: 'место',
  counterparty: 'с кем',
};

const DATE_PARAM_KEYS = new Set<string>(['dueDate', 'startAt', 'endAt']);

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, ' ').trim();
}

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
    @Inject(AiChatQuotaService)
    private readonly aiChatQuota: AiChatQuotaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(ConciergeStepScorerService)
    private readonly stepScorer: ConciergeStepScorerService | null = null,
  ) {}

  async *process(input: ProcessInput): AsyncIterable<ConciergeStreamEvent> {
    if (!this.cfg.concierge.enabled) {
      yield {
        type: 'error',
        code: 'concierge_disabled',
        message: 'Concierge Agent отключён в этой среде',
      };
      return;
    }

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

    const denial = await this.quota.tryConsume(input.tenantId);
    if (denial) {
      yield { type: 'quota_exceeded', scope: denial.scope };
      return;
    }

    this.metrics.incConciergeMessage?.({
      tenantTop: this.tenantTop(input.tenantId),
    });

    const conversation = await this.loadOrCreateConversation(input);
    yield { type: 'started', conversationId: conversation.id };

    await this.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: input.userMessage,
    });

    const effectiveQuestion = input.userMessage;

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

    const contextBlock = await this.contextBuilder.build({
      tenantId: input.tenantId,
      userId: input.userId,
      pageContext: input.pageContext ?? null,
    });

    const nativeTools = this.isNativeToolsEnabled();
    const llmTools = nativeTools ? this.serviceMap.toLlmTools(input.toolWhitelist) : [];

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

    const companyTail = await this.buildCompanyAboutTail(input.tenantId);
    const rawWithCompany = companyTail ? `${rawSystemPrompt}\n\n${companyTail}` : rawSystemPrompt;
    if (companyTail) this.metrics.incCompanyCapsuleInjected({ surface: 'concierge' });

    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(effectiveQuestion);
      for (const pattern of sanitized.reasons) {
        this.metrics.incPromptInjectionAttempt?.({ source: 'chat', pattern });
      }
    }
    const systemPrompt = guardOn ? withInjectionGuard(rawWithCompany) : rawWithCompany;
    const historyTake = await this.getHistoryMessagesCount();
    const history = await this.loadRecentHistory(conversation.id, historyTake);

    const executedTools: string[] = [];
    let askChatV2Capture: { text: string; citations: unknown[] } | null = null;

    let toolMessages: Array<{ role: 'tool'; content: string }> = [];
    let finalText = '';

    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      const rawUserBlock = this.composeConciergeUserBlock({
        contextBlock,
        summary: conversation.summary,
        history,
        toolMessages,
        message: effectiveQuestion,
      });
      const userBlock = guardOn ? wrapUserData(rawUserBlock) : rawUserBlock;

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
          ...(nativeTools ? { tools: llmTools } : {}),
        });
        parsed = nativeTools ? this.toolCallFromNativeOutput(out) : this.tryParseToolCall(out.text);
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

      const toolName = parsed.toolName;
      const params = parsed.params;

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
      const requiresConfirm =
        !!tool && tool.method !== 'GET' && !tool.readOnly && !tool.undoableVia;

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
          toolCalls: [{ id: `confirm_${i}`, name: toolName, arguments: params, held: true }],
        });
        yield { type: 'done', messageId: holdMsg.id };
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

      const shadowScoringPromise = this.maybeStartShadowScoring({
        llmCandidate: { toolName, args: params },
        systemPrompt,
        userMessage: userBlock,
        tenantId: input.tenantId,
        userId: input.userId,
        effectiveQuestion,
        history,
        preHits: [],
      });

      const execResult = await this.toolRouter.execute({
        toolName,
        args: params,
        userId: input.userId,
        tenantId: input.tenantId,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
        ...(input.authMode ? { authMode: input.authMode } : {}),
        ...(input.authCookie ? { authCookie: input.authCookie } : {}),
      });

      executedTools.push(toolName);
      if (toolName === 'ask_chat_v2' && execResult.ok) {
        askChatV2Capture = this.extractChatV2Answer(execResult.result);
      }

      let undoLogId: string | undefined;
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
    }

    let citations: unknown[] = [];
    const passthrough =
      executedTools.length === 1 && executedTools[0] === 'ask_chat_v2' && askChatV2Capture !== null;
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

    await this.prisma.conciergeConversation.updateMany({
      where: { id: conversation.id, tenantId: input.tenantId },
      data: { lastMessageAt: new Date() },
    });
  }

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

  private extractChatV2Answer(result: unknown): { text: string; citations: unknown[] } {
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>;
      const text = typeof obj.text === 'string' ? obj.text : '';
      const citations = Array.isArray(obj.citations) ? obj.citations : [];
      return { text, citations };
    }
    return { text: '', citations: [] };
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  private async loadOrCreateConversation(input: ProcessInput): Promise<ConciergeConversation> {
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

  private buildConfirmPreview(toolName: string, params: Record<string, unknown>): string {
    const ruName = CONFIRM_TOOL_RU_NAMES[toolName] ?? humanizeToolName(toolName);
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .slice(0, 4)
      .map(([k, v]) => {
        const label = PARAM_RU_LABELS[k] ?? k;
        let s: string;
        if (DATE_PARAM_KEYS.has(k) && typeof v === 'string') {
          s = formatRuDate(v);
        } else if (typeof v === 'string') {
          s = v;
        } else {
          try {
            s = JSON.stringify(v);
          } catch {
            s = String(v);
          }
        }
        return `${label} — ${s.slice(0, 80)}`;
      });
    return parts.length > 0 ? `${ruName}: ${parts.join(', ')}` : ruName;
  }

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

  private toolCallFromNativeOutput(
    out: Pick<LlmCallResult, 'text' | 'toolCalls'>,
  ):
    | { kind: 'tool_call'; toolName: string; params: Record<string, unknown> }
    | { kind: 'final'; text: string } {
    const first = out.toolCalls?.[0];
    if (!first) {
      return { kind: 'final', text: out.text.trim() };
    }
    const params =
      typeof first.input === 'object' && first.input !== null && !Array.isArray(first.input)
        ? (first.input as Record<string, unknown>)
        : {};
    return { kind: 'tool_call', toolName: first.name, params };
  }

  private tryParseToolCall(text: string):
    | {
        kind: 'tool_call';
        toolName: string;
        params: Record<string, unknown>;
      }
    | { kind: 'final'; text: string } {
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
      const sorted = [...scores].sort((a, b) => b.score - a.score);
      const llmHash = this.stableArgsHash(args.llmCandidate.args);
      const selectedRank =
        sorted.findIndex(
          (s) =>
            s.candidate.toolName === args.llmCandidate.toolName &&
            this.stableArgsHash(s.candidate.args) === llmHash,
        ) + 1;
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

      this.metrics.incConciergePrmAgreement?.({
        agreed: prmAgreed ? 'true' : 'false',
      });
      const rankLabel: '1' | '2' | '3' | 'other' =
        effectiveRank === 1 ? '1' : effectiveRank === 2 ? '2' : effectiveRank === 3 ? '3' : 'other';
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

  private async buildCompanyAboutTail(tenantId: string): Promise<string> {
    try {
      const profile = await this.prisma.companyProfile.findUnique({
        where: { tenantId },
        select: { displayName: true, stage: true, summaryJson: true, missionJson: true },
      });
      if (!profile) return '';
      const lines: string[] = [];
      const name = profile.displayName?.trim();
      if (name) lines.push(`Название: ${name}`);
      const summary = conciergeExtractContentMd(profile.summaryJson);
      if (summary) lines.push(`Чем занимается: ${summary}`);
      const stage = profile.stage?.trim();
      if (stage) lines.push(`Стадия: ${stage}`);
      if (lines.length === 0) return '';
      return ['## О компании', ...lines].join('\n');
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'concierge buildCompanyAboutTail: чтение профиля упало — секция опущена',
      );
      return '';
    }
  }
}

function conciergeExtractContentMd(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}
