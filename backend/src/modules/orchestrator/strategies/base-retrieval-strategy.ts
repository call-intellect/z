import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ChatV2RetrievalService } from '../../knowledge-core/services/chat-v2-retrieval.service';
import type {
  OrchestratorAgentType,
  OrchestratorPlanStep,
  OrchestratorSubagentResult,
} from '../orchestrator.types';

import type {
  SubagentExecuteInput,
  SubagentStrategy,
} from './subagent-strategy';

/**
 * SBA δ-1 — общий базовый класс subagent-стратегий.
 *
 * Делает следующее:
 *   1) retrieve относящиеся IdeaBlock'и через ChatV2RetrievalService (scope='org').
 *   2) подгружает текст блоков и evidence.
 *   3) вызывает LLM (taskType='orchestrator-subagent') с промптом стратегии.
 *   4) парсит ответ → OrchestratorSubagentResult.
 *
 * Расширяется конкретными стратегиями через `agentType` + `buildSystemPrompt`.
 */
@Injectable()
export abstract class BaseRetrievalStrategy implements SubagentStrategy {
  abstract readonly agentType: OrchestratorAgentType;
  protected readonly logger: Logger;

  constructor(
    @Inject(PrismaService) protected readonly prisma: PrismaService,
    @Inject(LlmRouterService) protected readonly llm: LlmRouterService,
    @Inject(ChatV2RetrievalService)
    protected readonly retrieval: ChatV2RetrievalService,
  ) {
    this.logger = new Logger(`${this.constructor.name}`);
  }

  /** Сформировать system prompt стратегии. */
  protected abstract buildSystemPrompt(step: OrchestratorPlanStep): string;

  /** Сформировать query для retrieval (по умолчанию — focus + seedHints). */
  protected buildRetrievalQuery(step: OrchestratorPlanStep): string {
    const seedPart =
      (step.contextSlice.seedHints ?? []).filter((s) => s && s.length > 0).join(', ');
    return seedPart
      ? `${step.contextSlice.focus}. ${seedPart}`
      : step.contextSlice.focus;
  }

  async execute(args: SubagentExecuteInput): Promise<OrchestratorSubagentResult> {
    const start = Date.now();

    let blockIds: string[] = [];
    try {
      const ranked = await this.retrieval.fetchCandidates({
        tenantId: args.tenantId,
        scope: 'org',
        scopeId: null,
        query: this.buildRetrievalQuery(args.step),
        limit: 20,
        graphHops: 1,
      });
      blockIds = ranked.map((r) => r.blockId).slice(0, 20);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'subagent retrieval failed — продолжаем без context',
      );
    }

    let blocksContext = '';
    if (blockIds.length > 0) {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: blockIds }, tenantId: args.tenantId },
        select: {
          id: true,
          name: true,
          criticalQuestion: true,
          trustedAnswer: true,
        },
        take: 20,
      });
      blocksContext = blocks
        .map(
          (b) =>
            `- [${b.id}] ${b.name}\n  Q: ${b.criticalQuestion.slice(0, 200)}\n  A: ${b.trustedAnswer.slice(0, 400)}`,
        )
        .join('\n');
    }

    const systemPrompt = this.buildSystemPrompt(args.step);
    const userMessage = [
      `Фокус задачи: ${args.step.contextSlice.focus}`,
      args.step.contextSlice.seedHints && args.step.contextSlice.seedHints.length > 0
        ? `Ключевые сущности/слова: ${args.step.contextSlice.seedHints.join(', ')}`
        : '',
      args.step.contextSlice.params &&
      Object.keys(args.step.contextSlice.params).length > 0
        ? `Параметры: ${JSON.stringify(args.step.contextSlice.params)}`
        : '',
      '',
      '=== ЗНАНИЯ КОМПАНИИ (релевантные блоки) ===',
      blocksContext || '(контекст не найден — отвечай по интуиции и помечай confidence ниже)',
      '',
      'Верни строго JSON, без markdown:',
      '{',
      '  "text": "<ответ на задачу>",',
      '  "citations": [{ "type": "block", "id": "<blockId>", "snippet": "..." }],',
      '  "confidence": 0.0..1.0',
      '}',
    ]
      .filter(Boolean)
      .join('\n');

    const remainingMs = Math.max(1_000, args.timeoutMs - (Date.now() - start));
    const llmPromise = this.llm.call({
      taskType: 'orchestrator-subagent',
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      userId: args.userId,
      maxTokens: 1500,
      responseFormat: { type: 'json_object' },
    });

    let raw: string;
    try {
      const out = await Promise.race([
        llmPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`subagent timeout after ${remainingMs}ms`)),
            remainingMs,
          ),
        ),
      ]);
      raw = (out as { text: string }).text ?? '';
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'subagent LLM call failed',
      );
      return {
        text: 'Subagent не смог выполнить задачу (LLM временно недоступен).',
        citations: [],
        confidence: 0,
      };
    }

    return this.tryParseResult(raw);
  }

  protected tryParseResult(raw: string): OrchestratorSubagentResult {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) {
        return { text: raw.trim().slice(0, 4000), citations: [], confidence: 0.3 };
      }
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return { text: raw.trim().slice(0, 4000), citations: [], confidence: 0.3 };
      }
    }
    if (!obj || typeof obj !== 'object') {
      return { text: raw.trim().slice(0, 4000), citations: [], confidence: 0.3 };
    }
    const o = obj as {
      text?: unknown;
      citations?: unknown;
      confidence?: unknown;
    };
    const text =
      typeof o.text === 'string' && o.text.trim().length > 0
        ? o.text.trim().slice(0, 4000)
        : raw.trim().slice(0, 4000);
    const citations = Array.isArray(o.citations)
      ? o.citations
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .map((c) => ({
            type:
              (c['type'] as string) === 'entity'
                ? ('entity' as const)
                : (c['type'] as string) === 'meeting'
                  ? ('meeting' as const)
                  : (c['type'] as string) === 'card'
                    ? ('card' as const)
                    : (c['type'] as string) === 'document'
                      ? ('document' as const)
                      : ('block' as const),
            id: String(c['id'] ?? '').slice(0, 128),
            ...(typeof c['snippet'] === 'string'
              ? { snippet: (c['snippet'] as string).slice(0, 400) }
              : {}),
          }))
          .filter((c) => c.id.length > 0)
          .slice(0, 20)
      : [];
    const confidence =
      typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1
        ? o.confidence
        : 0.6;
    return { text, citations, confidence };
  }
}
