import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

import { type LlmCallResult, LlmRouterService } from './llm-router.service';
import { calcCostUsd } from './model-prices';

@Injectable()
export class MultiAgentDebateService {
  private readonly logger = new Logger(MultiAgentDebateService.name);

  private static readonly STANCE_TASK_TYPES_BY_FAMILY: Record<
    DebateTaskFamily,
    Record<DebateStance, string>
  > = {
    'decision-supersede': {
      'strict-critic': 'debate-decision-supersede-critic',
      'empathetic-supporter': 'debate-decision-supersede-supporter',
      'neutral-judge': 'debate-decision-supersede-neutral',
    },
    'curation-verify': {
      'strict-critic': 'debate-curation-verify-critic',
      'empathetic-supporter': 'debate-curation-verify-supporter',
      'neutral-judge': 'debate-curation-verify-neutral',
    },
    'conflict-arbiter': {
      'strict-critic': 'debate-conflict-arbiter-critic',
      'empathetic-supporter': 'debate-conflict-arbiter-supporter',
      'neutral-judge': 'debate-conflict-arbiter-neutral',
    },
  };

  private resolveStanceTaskType(family: DebateTaskFamily, stance: DebateStance): string {
    const byStance =
      MultiAgentDebateService.STANCE_TASK_TYPES_BY_FAMILY[family] ??
      MultiAgentDebateService.STANCE_TASK_TYPES_BY_FAMILY['decision-supersede'];
    return byStance[stance];
  }

  private resolveStanceSystemPrompt(family: DebateTaskFamily, stance: DebateStance): string {
    const byStance =
      STANCE_SYSTEM_PROMPTS_BY_FAMILY[family] ??
      STANCE_SYSTEM_PROMPTS_BY_FAMILY['decision-supersede'];
    return byStance[stance];
  }

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  async judge(req: DebateRequest): Promise<DebateVerdict> {
    const family: DebateTaskFamily = req.taskFamily ?? 'decision-supersede';
    const n = req.n ?? this.cfg?.debate.defaultN ?? 3;
    const rounds = req.rounds ?? this.cfg?.debate.defaultRounds ?? 1;
    const costCap = this.cfg?.debate.costCapUsdPerRun ?? 0.05;
    const round2Enabled = this.cfg?.debate.round2Enabled ?? false;
    const tenantTop = tenantTopOf(req.tenantId);

    const stances: DebateStance[] = ['strict-critic', 'empathetic-supporter', 'neutral-judge'];
    const targetStances = stances.slice(0, Math.max(1, n));

    const round1Settled = await Promise.allSettled(
      targetStances.map((stance) =>
        this.callOneStance({
          stance,
          family,
          task: req.task,
          candidates: req.candidates,
          contextBlocks: req.contextBlocks,
          tenantId: req.tenantId,
          priorVotes: null,
        }),
      ),
    );

    const round1Votes: DebateVote[] = [];
    const round1Failures: Array<{ stance: DebateStance; error: string }> = [];
    for (let i = 0; i < round1Settled.length; i++) {
      const settled = round1Settled[i] as PromiseSettledResult<DebateVote>;
      const stance = targetStances[i] as DebateStance;
      if (settled.status === 'fulfilled') {
        round1Votes.push(settled.value);
      } else {
        round1Failures.push({
          stance,
          error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        });
      }
    }

    let totalCostUsd = round1Votes.reduce((sum, v) => sum + v.costUsd, 0);

    if (totalCostUsd > costCap) {
      this.logger.warn(
        {
          taskType: req.taskType,
          totalCostUsd,
          costCap,
          votes: round1Votes.length,
        },
        'MultiAgentDebate: cost cap exceeded, fallback to majority of partial votes',
      );
      this.metrics?.incDebateFallbackToSingle({ reason: 'cost_cap' });
      const verdict = this.buildVerdictFromVotes({
        votes: round1Votes,
        rounds: 1,
        totalCostUsd,
        fallbackUsed: 'cost_cap',
        taskType: req.taskType,
        tenantTop,
      });
      return verdict;
    }

    if (round1Votes.length === 0) {
      this.logger.warn(
        {
          taskType: req.taskType,
          failures: round1Failures,
        },
        'MultiAgentDebate: все провайдеры упали — fallback split_uncertain',
      );
      this.metrics?.incDebateFallbackToSingle({ reason: 'provider_unavailable' });
      const verdict: DebateVerdict = {
        decision: 'split_uncertain',
        votes: [],
        consensusType: 'split',
        rounds: 1,
        totalCostUsd: 0,
        fallbackUsed: 'provider_unavailable',
      };
      this.metrics?.incDebateJudgment({
        taskType: req.taskType,
        decision: verdict.decision,
        consensusType: verdict.consensusType,
      });
      return verdict;
    }

    this.reportDisagreements({
      votes: round1Votes,
      taskType: req.taskType,
    });

    const round1Consensus = this.computeConsensus(round1Votes);

    if (round1Consensus.consensusType === 'split' && rounds >= 2 && round2Enabled) {
      this.metrics?.incDebateRound2Triggered({ taskType: req.taskType });
      const round2Settled = await Promise.allSettled(
        targetStances.map((stance) =>
          this.callOneStance({
            stance,
            family,
            task: req.task,
            candidates: req.candidates,
            contextBlocks: req.contextBlocks,
            tenantId: req.tenantId,
            priorVotes: round1Votes,
          }),
        ),
      );
      const round2Votes: DebateVote[] = [];
      for (const settled of round2Settled) {
        if (settled.status === 'fulfilled') {
          round2Votes.push(settled.value);
        }
      }
      totalCostUsd += round2Votes.reduce((sum, v) => sum + v.costUsd, 0);
      if (round2Votes.length > 0) {
        this.reportDisagreements({
          votes: round2Votes,
          taskType: req.taskType,
        });
        return this.buildVerdictFromVotes({
          votes: round2Votes,
          rounds: 2,
          totalCostUsd,
          fallbackUsed: null,
          taskType: req.taskType,
          tenantTop,
        });
      }
    }

    return this.buildVerdictFromVotes({
      votes: round1Votes,
      rounds: 1,
      totalCostUsd,
      fallbackUsed: null,
      taskType: req.taskType,
      tenantTop,
    });
  }

  private async callOneStance(args: {
    stance: DebateStance;
    family: DebateTaskFamily;
    task: string;
    candidates: unknown[];
    contextBlocks: unknown[];
    tenantId: string;
    priorVotes: DebateVote[] | null;
  }): Promise<DebateVote> {
    const taskType = this.resolveStanceTaskType(args.family, args.stance);
    const systemPrompt = this.resolveStanceSystemPrompt(args.family, args.stance);
    const userMessage = this.buildUserMessage({
      task: args.task,
      candidates: args.candidates,
      contextBlocks: args.contextBlocks,
      priorVotes: args.priorVotes,
    });

    const result: LlmCallResult = await this.llm.call({
      taskType: taskType as Parameters<LlmRouterService['call']>[0]['taskType'],
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      responseFormat: {
        type: 'json_schema',
        name: DEBATE_VOTE_SCHEMA_NAME,
        schema: DEBATE_VOTE_JSON_SCHEMA,
        strict: true,
      },
      sourceRef: { type: 'debate-stance', id: args.stance },
    });

    const parsed = parseDebateVoteResponse(result.text);
    const { provider, model } = parseModelUsed(result.modelUsed);
    const costUsd = calcCostUsd(
      model,
      result.inputTokens ?? 0,
      result.outputTokens ?? 0,
      result.cachedTokens ?? 0,
    );

    return {
      stance: args.stance,
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      provider,
      costUsd,
    };
  }

  private buildUserMessage(args: {
    task: string;
    candidates: unknown[];
    contextBlocks: unknown[];
    priorVotes: DebateVote[] | null;
  }): string {
    const parts: string[] = [];
    parts.push(`Задача: ${args.task}`);
    parts.push(`Кандидаты: ${JSON.stringify(args.candidates)}`);
    if (args.contextBlocks.length > 0) {
      parts.push(`Контекст: ${JSON.stringify(args.contextBlocks)}`);
    }
    if (args.priorVotes && args.priorVotes.length > 0) {
      const priorSummary = args.priorVotes
        .map(
          (v) =>
            `[${v.stance}] verdict=${v.verdict} confidence=${v.confidence.toFixed(2)} reasoning=${v.reasoning.slice(0, 300)}`,
        )
        .join('\n');
      parts.push('Голоса коллег в round 1:');
      parts.push(priorSummary);
    }
    parts.push('Верни JSON по схеме debate_vote_v1.');
    return parts.join('\n\n');
  }

  private buildVerdictFromVotes(args: {
    votes: DebateVote[];
    rounds: number;
    totalCostUsd: number;
    fallbackUsed: 'cost_cap' | 'provider_unavailable' | null;
    taskType: string;
    tenantTop: string;
  }): DebateVerdict {
    const consensus = this.computeConsensus(args.votes);
    const verdict: DebateVerdict = {
      decision: consensus.decision,
      votes: args.votes,
      consensusType: consensus.consensusType,
      rounds: args.rounds,
      totalCostUsd: Math.round(args.totalCostUsd * 1_000_000) / 1_000_000,
      fallbackUsed: args.fallbackUsed,
    };

    this.metrics?.incDebateJudgment({
      taskType: args.taskType,
      decision: verdict.decision,
      consensusType: verdict.consensusType,
    });
    this.metrics?.incDebateCost({
      tenantTop: args.tenantTop,
      taskType: args.taskType,
      costUsd: verdict.totalCostUsd,
    });

    return verdict;
  }

  private computeConsensus(votes: readonly DebateVote[]): {
    decision: string;
    consensusType: 'unanimous' | 'majority' | 'split';
  } {
    if (votes.length === 0) {
      return { decision: 'split_uncertain', consensusType: 'split' };
    }
    const counts = new Map<string, number>();
    for (const v of votes) {
      counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
    }
    let topVerdict = '';
    let topCount = 0;
    for (const [verdict, count] of counts.entries()) {
      if (count > topCount) {
        topVerdict = verdict;
        topCount = count;
      }
    }
    if (topCount === votes.length) {
      return { decision: topVerdict, consensusType: 'unanimous' };
    }
    if (topCount >= 2) {
      return { decision: topVerdict, consensusType: 'majority' };
    }
    return { decision: 'split_uncertain', consensusType: 'split' };
  }

  private reportDisagreements(args: { votes: DebateVote[]; taskType: string }): void {
    const votes = args.votes;
    for (let i = 0; i < votes.length; i++) {
      const a = votes[i] as DebateVote;
      for (let j = i + 1; j < votes.length; j++) {
        const b = votes[j] as DebateVote;
        if (a.verdict === b.verdict) continue;
        const [providerA, providerB] = [a.provider, b.provider].sort();
        this.metrics?.incDebateProviderDisagreement({
          providerA: providerA ?? 'unknown',
          providerB: providerB ?? 'unknown',
          taskType: args.taskType,
        });
      }
    }
  }
}

export type DebateStance = 'strict-critic' | 'empathetic-supporter' | 'neutral-judge';

export type DebateTaskFamily = 'decision-supersede' | 'curation-verify' | 'conflict-arbiter';

export interface DebateRequest {
  task: string;
  candidates: unknown[];
  contextBlocks: unknown[];
  taskFamily?: DebateTaskFamily;
  n?: number;
  rounds?: number;
  taskType: string;
  tenantId: string;
}

export interface DebateVote {
  stance: DebateStance;
  verdict: string;
  reasoning: string;
  confidence: number;
  provider: string;
  costUsd: number;
}

export interface DebateVerdict {
  decision: string;
  votes: DebateVote[];
  consensusType: 'unanimous' | 'majority' | 'split';
  rounds: number;
  totalCostUsd: number;
  fallbackUsed: 'cost_cap' | 'provider_unavailable' | null;
}

const DECISION_SUPERSEDE_RULE =
  'При противоречии источников бери более позднее / актуальное решение; устаревшее считай заменённым, не смешивай старую и новую редакцию в одно.';

const STANCE_SYSTEM_PROMPTS: Record<DebateStance, string> = {
  'strict-critic': [
    'Ты — строгий критик. Твоя задача — найти причины НЕ принимать предложенного кандидата.',
    'Default — отказ при любом сомнении. Если есть хоть один риск, contradiction, недостаточный сигнал или сомнение в источнике — голосуй против.',
    DECISION_SUPERSEDE_RULE,
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'empathetic-supporter': [
    'Ты — поддерживающий арбитр. Твоя задача — найти причины ПРИНЯТЬ предложенного кандидата.',
    'Default — принятие при наличии хоть какого-то осмысленного сигнала. Сомнения трактуй в пользу кандидата, если нет явных противоречий.',
    DECISION_SUPERSEDE_RULE,
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'neutral-judge': [
    'Ты — нейтральный арбитр. Взвесь pro и contra одинаково: ни критик, ни сторонник.',
    'Дай честную оценку: что говорит за, что против, и какое решение более обосновано фактами.',
    DECISION_SUPERSEDE_RULE,
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
};

const CURATION_VERIFY_SYSTEM_PROMPTS: Record<DebateStance, string> = {
  'strict-critic': [
    'Ты — строгий критик-аудитор знаний компании. Решаешь, должна ли карточка быть канонизирована в постоянную память компании.',
    'Default — reject при любом сомнении. Голосуй reject, если формулировка расплывчата, не обоснована фактами, противоречит здравому смыслу, дублирует существующее знание или источник вызывает сомнение.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'empathetic-supporter': [
    'Ты — поддерживающий арбитр-куратор знаний компании. Решаешь, должна ли карточка быть канонизирована в постоянную память компании.',
    'Default — accept при наличии осмысленного, обоснованного содержания. Сомнения трактуй в пользу карточки, если нет явных противоречий или вреда.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'neutral-judge': [
    'Ты — нейтральный арбитр качества знаний компании. Взвесь pro и contra канонизации карточки одинаково: ни критик, ни сторонник.',
    'Оцени: корректна ли карточка, обоснована ли фактами, достаточно ли ясна формулировка, чтобы стать каноническим знанием компании.',
    'Verdict строго: accept | reject. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
};

const CONFLICT_ARBITER_SYSTEM_PROMPTS: Record<DebateStance, string> = {
  'strict-critic': [
    'Ты — строгий критик-хранитель памяти компании. Два утверждения памяти компании конфликтуют: существующее (existing) и новое (new). Реши, какой исход верен.',
    'Ты консервативен: при любом сомнении сохраняй проверенное существующее знание (keep_old). Если данных недостаточно, источники ненадёжны или цена ошибки высока — голосуй escalate (передать человеку).',
    'Verdict строго: keep_old | accept_new | merge | evolving | escalate. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'empathetic-supporter': [
    'Ты — арбитр обновления памяти компании. Два утверждения памяти компании конфликтуют: существующее (existing) и новое (new). Реши, какой исход верен.',
    'Ты за актуальность знаний: если новое утверждение обосновано (свежее, конкретнее, подтверждено материалами дела) — голосуй accept_new. Но не принимай новое лишь потому, что оно новое: без обоснованности это не обновление.',
    'Verdict строго: keep_old | accept_new | merge | evolving | escalate. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'neutral-judge': [
    'Ты — нейтральный арбитр памяти компании. Два утверждения памяти компании конфликтуют: существующее (existing) и новое (new). Взвесь оба без предпочтений: ни критик, ни сторонник.',
    'Если оба утверждения частично верны и дополняют друг друга — merge. Если оба верны, но в разное время (новое сменило старое с какого-то момента) — evolving. Если для решения нужна управленческая оценка или знание вне материалов дела — escalate. Иначе выбери keep_old или accept_new по фактам.',
    'Verdict строго: keep_old | accept_new | merge | evolving | escalate. Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
};

const STANCE_SYSTEM_PROMPTS_BY_FAMILY: Record<DebateTaskFamily, Record<DebateStance, string>> = {
  'decision-supersede': STANCE_SYSTEM_PROMPTS,
  'curation-verify': CURATION_VERIFY_SYSTEM_PROMPTS,
  'conflict-arbiter': CONFLICT_ARBITER_SYSTEM_PROMPTS,
};

export const DEBATE_VOTE_SCHEMA_NAME = 'debate_vote_v1';

export const DEBATE_VOTE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasoning', 'confidence'],
  properties: {
    verdict: {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      description:
        'Решение по задаче (например, для supersede-detect: "new" | "merge" | "supersedes"). Короткая строка-токен.',
    },
    reasoning: {
      type: 'string',
      minLength: 0,
      maxLength: 2000,
      description:
        'Обоснование на русском, до 200 слов. Что увидел голосующий и почему такой verdict.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Уверенность голосующего в своём verdict (0..1).',
    },
  },
};

function parseDebateVoteResponse(text: string): {
  verdict: string;
  reasoning: string;
  confidence: number;
} {
  try {
    const raw = JSON.parse(text) as {
      verdict?: unknown;
      reasoning?: unknown;
      confidence?: unknown;
    };
    const verdict =
      typeof raw.verdict === 'string' && raw.verdict.length > 0 ? raw.verdict : 'unknown';
    const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning : '';
    const confidenceNum = typeof raw.confidence === 'number' ? raw.confidence : 0;
    const confidence = Math.max(0, Math.min(1, confidenceNum));
    return { verdict, reasoning, confidence };
  } catch {
    return { verdict: 'unknown', reasoning: '', confidence: 0 };
  }
}

function parseModelUsed(modelUsed: string): {
  provider: string;
  model: string;
} {
  const idx = modelUsed.indexOf(':');
  if (idx <= 0) return { provider: 'unknown', model: modelUsed };
  return {
    provider: modelUsed.slice(0, idx),
    model: modelUsed.slice(idx + 1),
  };
}
