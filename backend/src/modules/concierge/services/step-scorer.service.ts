import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import {
  CONCIERGE_STEP_PRM_JSON_SCHEMA,
  CONCIERGE_STEP_PRM_SCHEMA_NAME,
  CONCIERGE_STEP_PRM_SYSTEM_PROMPT,
  CONCIERGE_STEP_PRM_USER_TEMPLATE,
} from '../prompts/concierge-step-prm.prompt';

export interface StepCandidate {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

export interface StepScore {
  candidate: StepCandidate;
  score: number;
  reasoning: string;
}

interface ScorerCallArgs {
  goal: string;
  history: unknown[];
  retrievedContext: unknown[];
  tenantId: string;
}

export interface ScoreStepArgs extends ScorerCallArgs {
  candidate: StepCandidate;
}

export interface ScoreAllCandidatesArgs extends ScorerCallArgs {
  candidates: StepCandidate[];
}

const MAX_HISTORY_MSGS_IN_DIGEST = 6;
const MAX_CONTEXT_HITS_IN_DIGEST = 5;
const DEFAULT_REASONING_FALLBACK = 'PRM не вернул внятного reasoning.';

@Injectable()
export class ConciergeStepScorerService {
  private readonly logger = new Logger(ConciergeStepScorerService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async scoreStep(args: ScoreStepArgs): Promise<StepScore> {
    const userMessage = CONCIERGE_STEP_PRM_USER_TEMPLATE({
      goal: args.goal,
      historyDigest: this.digestHistory(args.history),
      retrievedContextDigest: this.digestContext(args.retrievedContext),
      candidate: args.candidate,
    });
    const guarded = applyInputGuards(CONCIERGE_STEP_PRM_SYSTEM_PROMPT, userMessage, {
      injection: true,
    });
    try {
      const out = await this.llm.call({
        taskType: 'concierge-step-prm',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: args.tenantId,
        maxTokens: 400,
        responseFormat: {
          type: 'json_schema',
          name: CONCIERGE_STEP_PRM_SCHEMA_NAME,
          schema: CONCIERGE_STEP_PRM_JSON_SCHEMA,
          strict: true,
        },
      });
      const parsed = this.parseScoreResponse(out.text);
      if (parsed) {
        return {
          candidate: args.candidate,
          score: parsed.score,
          reasoning: parsed.reasoning,
        };
      }
      this.logger.warn(
        {
          taskType: 'concierge-step-prm',
          toolName: args.candidate.toolName,
          rawHead: out.text.slice(0, 200),
        },
        'concierge PRM: не удалось распарсить JSON ответа (fallback score=0)',
      );
      return {
        candidate: args.candidate,
        score: 0,
        reasoning: 'PRM вернул невалидный JSON',
      };
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        {
          err: m,
          toolName: args.candidate.toolName,
          tenantId: args.tenantId,
        },
        'concierge PRM scoreStep failed (shadow no-op, fallback score=0)',
      );
      return {
        candidate: args.candidate,
        score: 0,
        reasoning: `PRM провайдер недоступен: ${m.slice(0, 200)}`,
      };
    }
  }

  async scoreAllCandidates(args: ScoreAllCandidatesArgs): Promise<StepScore[]> {
    if (args.candidates.length === 0) return [];
    return Promise.all(
      args.candidates.map((candidate) =>
        this.scoreStep({
          goal: args.goal,
          history: args.history,
          retrievedContext: args.retrievedContext,
          tenantId: args.tenantId,
          candidate,
        }),
      ),
    );
  }

  private digestHistory(history: unknown[]): string {
    if (!Array.isArray(history) || history.length === 0) return '';
    const tail = history.slice(-MAX_HISTORY_MSGS_IN_DIGEST);
    const items = tail.map((m) => {
      if (m && typeof m === 'object') {
        const obj = m as Record<string, unknown>;
        const role = typeof obj.role === 'string' ? obj.role : 'msg';
        const content =
          typeof obj.content === 'string'
            ? obj.content.slice(0, 200)
            : JSON.stringify(obj).slice(0, 200);
        return `[${role}] ${content}`;
      }
      return JSON.stringify(m).slice(0, 200);
    });
    return items.join('\n');
  }

  private digestContext(retrievedContext: unknown[]): string {
    if (!Array.isArray(retrievedContext) || retrievedContext.length === 0) {
      return '';
    }
    const head = retrievedContext.slice(0, MAX_CONTEXT_HITS_IN_DIGEST);
    return head
      .map((item, idx) => {
        try {
          return `#${idx + 1} ${JSON.stringify(item).slice(0, 300)}`;
        } catch {
          return `#${idx + 1} (нечитаемый элемент)`;
        }
      })
      .join('\n');
  }

  private parseScoreResponse(text: string): { score: number; reasoning: string } | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]) as {
        score?: unknown;
        reasoning?: unknown;
      };
      if (typeof obj.score !== 'number' || !Number.isFinite(obj.score)) {
        return null;
      }
      const score = Math.min(Math.max(obj.score, 0), 1);
      const reasoning =
        typeof obj.reasoning === 'string' && obj.reasoning.trim() !== ''
          ? obj.reasoning.slice(0, 500)
          : DEFAULT_REASONING_FALLBACK;
      return { score, reasoning };
    } catch {
      return null;
    }
  }
}
