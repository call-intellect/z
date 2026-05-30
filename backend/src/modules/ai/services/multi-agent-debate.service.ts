import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

import { type LlmCallResult, LlmRouterService } from './llm-router.service';
import { calcCostUsd } from './model-prices';

/**
 * Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate Service.
 *
 * Реализует трёх-голосовый debate-арбитр для критичных, nuanced-задач
 * (на старте — только `decision-supersede-detect`). Идея: три провайдера
 * с разными «характерами» оценивают одного кандидата и голосуют —
 * majority verdict идёт в production. Источник доказательств:
 * Du et al. Multi-Agent Debate (+5-15% accuracy на reasoning,
 * diverse providers > homogeneous).
 *
 * Round 1 — три параллельных LLM-вызова:
 *   - strict-critic       → debate-decision-supersede-critic
 *                           (primary deepseek-v4-pro, склонна к отказу)
 *   - empathetic-supporter → debate-decision-supersede-supporter
 *                           (primary openai-via-proxy/gpt-5.4, diverse провайдер)
 *   - neutral-judge       → debate-decision-supersede-neutral
 *                           (primary deepseek-v4-flash, дешёвый арбитр)
 *
 * Каждый stance — отдельный `LlmTaskType` со своим LlmTaskRoute,
 * чтобы админ мог тюнить модели каждого голоса отдельно через
 * /admin/llm-routes. Логически они входят в зонтичный
 * `debate-decision-supersede` (seed-запись для агрегатной аналитики).
 *
 * Round 2 (опц.) — если round 1 = split (1-1-1) AND
 * `cfg.debate.round2Enabled`: каждому stance передаются голоса других
 * с их reasoning, и они голосуют повторно. Метрика
 * `z_debate_round2_triggered_total`.
 *
 * Budget cap — если суммарный cost голосов превысил
 * `cfg.debate.costCapUsdPerRun` (default $0.05) — лог warn,
 * `fallbackUsed='cost_cap'`, majority-verdict из голосов, что успели прийти
 * (если их 0 — escalate как split_uncertain), метрика
 * `z_debate_fallback_to_single_total{reason='cost_cap'}`.
 *
 * Cost calculation: считаем через `calcCostUsd(model, in, out)` поверх
 * `LlmCallResult.modelUsed` (формат `provider:model`). Если провайдер/
 * модель не в `MODEL_PRICES` — cost = 0 (calcCostUsd возвращает 0 для
 * неизвестных моделей); это согласовано с `LlmRouterService.computeCostUsd`.
 *
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §A2 и feedback
 * `LLM-промпты — обязательно cache-friendly`: SYSTEM каждого stance
 * стабилен, переменные данные — в конце user.
 */
@Injectable()
export class MultiAgentDebateService {
  private readonly logger = new Logger(MultiAgentDebateService.name);

  /**
   * Stance-specific `LlmTaskType`'ы. Каждый — отдельный route в БД,
   * админ может тюнить модели каждого голоса.
   */
  private static readonly STANCE_TASK_TYPES = {
    'strict-critic': 'debate-decision-supersede-critic',
    'empathetic-supporter': 'debate-decision-supersede-supporter',
    'neutral-judge': 'debate-decision-supersede-neutral',
  } as const;

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * Главный публичный метод. Возвращает debate verdict.
   *
   * - На первой итерации (round 1) дёргает 3 голоса параллельно через
   *   `Promise.allSettled` (rejected stances считаются failures, но не
   *   ломают весь run — majority строится из тех, кто пришёл).
   * - Если суммарный cost превысил `costCapUsdPerRun` — fallbackUsed='cost_cap'.
   * - Если 2+ голоса вернули один verdict — consensus (unanimous/majority).
   * - Если 1-1-1 (split) AND round2Enabled AND req.rounds>=2 — round 2.
   *
   * Метрики: `z_debate_judgments_total`, `z_debate_cost_usd_total`,
   * `z_debate_provider_disagreement_total`, `z_debate_round2_triggered_total`,
   * `z_debate_fallback_to_single_total`.
   */
  async judge(req: DebateRequest): Promise<DebateVerdict> {
    const n = req.n ?? this.cfg?.debate.defaultN ?? 3;
    const rounds = req.rounds ?? this.cfg?.debate.defaultRounds ?? 1;
    const costCap = this.cfg?.debate.costCapUsdPerRun ?? 0.05;
    const round2Enabled = this.cfg?.debate.round2Enabled ?? false;
    const tenantTop = tenantTopOf(req.tenantId);

    // Round 1 — параллельно дёргаем 3 голоса.
    const stances: DebateStance[] = [
      'strict-critic',
      'empathetic-supporter',
      'neutral-judge',
    ];
    const targetStances = stances.slice(0, Math.max(1, n));

    const round1Settled = await Promise.allSettled(
      targetStances.map((stance) =>
        this.callOneStance({
          stance,
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
          error:
            settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason),
        });
      }
    }

    let totalCostUsd = round1Votes.reduce((sum, v) => sum + v.costUsd, 0);

    // Cost cap check — если round 1 уже превысил cap, fallback.
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

    // Все голоса упали? — fallback к provider_unavailable.
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

    // Учёт расхождений между провайдерами в round 1 (попарно).
    this.reportDisagreements({
      votes: round1Votes,
      taskType: req.taskType,
    });

    const round1Consensus = this.computeConsensus(round1Votes);

    // Round 2 — только при split + флаге + rounds>=2.
    if (
      round1Consensus.consensusType === 'split' &&
      rounds >= 2 &&
      round2Enabled
    ) {
      this.metrics?.incDebateRound2Triggered({ taskType: req.taskType });
      const round2Settled = await Promise.allSettled(
        targetStances.map((stance) =>
          this.callOneStance({
            stance,
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
      // Если round 2 пустой — fallback к round 1 split.
      if (round2Votes.length > 0) {
        // Учёт расхождений и в round 2.
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

  // ─────────────────────────── private ──────────────────────────────────

  /**
   * Один параллельный stance-вызов: stance-specific systemPrompt +
   * stance-specific taskType (отдельный route в БД на провайдер).
   */
  private async callOneStance(args: {
    stance: DebateStance;
    task: string;
    candidates: unknown[];
    contextBlocks: unknown[];
    tenantId: string;
    priorVotes: DebateVote[] | null;
  }): Promise<DebateVote> {
    const taskType = MultiAgentDebateService.STANCE_TASK_TYPES[args.stance];
    const systemPrompt = STANCE_SYSTEM_PROMPTS[args.stance];
    const userMessage = this.buildUserMessage({
      task: args.task,
      candidates: args.candidates,
      contextBlocks: args.contextBlocks,
      priorVotes: args.priorVotes,
    });

    const result: LlmCallResult = await this.llm.call({
      taskType: taskType as Parameters<
        LlmRouterService['call']
      >[0]['taskType'],
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

  /**
   * Сборка user-message: задача + кандидаты + контекст + (опц.) голоса round 1.
   *
   * Переменные данные — в самом конце, SYSTEM стабилен → cache-friendly
   * (см. feedback `LLM-промпты — обязательно cache-friendly`).
   */
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
      // Round 2 — даём stance'у голоса коллег, чтобы он мог их учесть.
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

  /**
   * Сборка финального verdict'а из голосов: majority logic.
   *
   * Также эмитит итоговую метрику `z_debate_judgments_total` и
   * `z_debate_cost_usd_total`.
   */
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

  /**
   * Majority verdict.
   *   - 3 одинаковых → unanimous.
   *   - 2 одинаковых → majority (decision = majority verdict).
   *   - все разные (1-1-1) → split, decision='split_uncertain'.
   *   - 0 голосов → split, decision='split_uncertain'.
   */
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
    // Все разные (1-1-1) — split.
    return { decision: 'split_uncertain', consensusType: 'split' };
  }

  /**
   * Попарный учёт расхождений между провайдерами. Эмитит метрику
   * `z_debate_provider_disagreement_total{provider_a, provider_b, task_type}`,
   * где провайдеры отсортированы лексикографически (нормализация
   * cardinality: пара (A,B) и (B,A) считается одной).
   */
  private reportDisagreements(args: {
    votes: DebateVote[];
    taskType: string;
  }): void {
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

// ─────────────────────────── types ────────────────────────────────────

export type DebateStance =
  | 'strict-critic'
  | 'empathetic-supporter'
  | 'neutral-judge';

export interface DebateRequest {
  task: string;
  candidates: unknown[];
  contextBlocks: unknown[];
  /** Сколько голосов в round 1. Default из `cfg.debate.defaultN` (3). */
  n?: number;
  /** Сколько round'ов. Default из `cfg.debate.defaultRounds` (1). */
  rounds?: number;
  /** Зонтичный taskType (обычно `debate-decision-supersede`). */
  taskType: string;
  /** Tenant — для cardinality-safe бакетирования cost-метрики. */
  tenantId: string;
}

export interface DebateVote {
  stance: DebateStance;
  verdict: string;
  reasoning: string;
  confidence: number;
  /** Имя провайдера, который реально ответил (`deepseek` / `openai-via-proxy` / …). */
  provider: string;
  costUsd: number;
}

export interface DebateVerdict {
  /**
   * Финальное решение. Для consensus (`unanimous`|`majority`) —
   * majority verdict; для `split` — литерал `'split_uncertain'`.
   */
  decision: string;
  votes: DebateVote[];
  consensusType: 'unanimous' | 'majority' | 'split';
  rounds: number;
  totalCostUsd: number;
  /**
   * Если debate не сработал штатно — причина fallback'а. NULL = всё ок.
   * Caller (специалист) должен учесть `fallbackUsed` и принять решение
   * о следующем шаге (escalate в curation, fallback к single LLM и т.п.).
   */
  fallbackUsed: 'cost_cap' | 'provider_unavailable' | null;
}

// ─────────────────────────── prompts ──────────────────────────────────

/**
 * Stance-specific SYSTEM-промпты. Стабильные строки, без переменных —
 * cache-friendly (см. feedback `LLM-промпты — обязательно cache-friendly`,
 * second-brain/02_architecture/llm-cache-status.md).
 *
 * Промпты ≤200 слов reasoning хочется на выходе, но в SYSTEM мы говорим
 * только о роли и формате — переменные данные (задача, кандидаты,
 * голоса коллег) — в user.
 */
const STANCE_SYSTEM_PROMPTS: Record<DebateStance, string> = {
  'strict-critic': [
    'Ты — строгий критик. Твоя задача — найти причины НЕ принимать предложенного кандидата.',
    'Default — отказ при любом сомнении. Если есть хоть один риск, contradiction, недостаточный сигнал или сомнение в источнике — голосуй против.',
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'empathetic-supporter': [
    'Ты — поддерживающий арбитр. Твоя задача — найти причины ПРИНЯТЬ предложенного кандидата.',
    'Default — принятие при наличии хоть какого-то осмысленного сигнала. Сомнения трактуй в пользу кандидата, если нет явных противоречий.',
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
  'neutral-judge': [
    'Ты — нейтральный арбитр. Взвесь pro и contra одинаково: ни критик, ни сторонник.',
    'Дай честную оценку: что говорит за, что против, и какое решение более обосновано фактами.',
    'Reasoning — до 200 слов. Верни JSON по схеме debate_vote_v1: verdict + reasoning + confidence (0..1).',
  ].join('\n'),
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

// ─────────────────────────── helpers ──────────────────────────────────

/**
 * Парсит LLM-ответ (строго JSON через json_schema strict) в типизированный
 * vote. Если парсинг упал — fallback к default vote с confidence=0.
 */
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
      typeof raw.verdict === 'string' && raw.verdict.length > 0
        ? raw.verdict
        : 'unknown';
    const reasoning =
      typeof raw.reasoning === 'string' ? raw.reasoning : '';
    const confidenceNum =
      typeof raw.confidence === 'number' ? raw.confidence : 0;
    const confidence = Math.max(0, Math.min(1, confidenceNum));
    return { verdict, reasoning, confidence };
  } catch {
    return { verdict: 'unknown', reasoning: '', confidence: 0 };
  }
}

/**
 * `LlmCallResult.modelUsed` имеет формат `<provider>:<model>`. Парсим
 * на пару. Если формат сломан — возвращаем `{provider:'unknown', model:''}`.
 */
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
