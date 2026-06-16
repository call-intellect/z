import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DataClass, LlmRouteTier, LlmTaskRoute } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';
import { AnthropicService } from './anthropic.service';
import { BudgetGuardService } from './budget-guard.service';
import { DeepSeekService } from './deepseek.service';
import { GrsaiService } from './grsai.service';
import { KieService } from './kie.service';
import { LlmInvalidOutputError } from './llm.types';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmResponseFormat,
  LlmReasoningEffort,
  LlmTool,
  LlmToolCall,
} from './llm.types';
import { MinimaxService } from './minimax.service';
import { calcCostUsd, MODEL_PRICES } from './model-prices';
import { OllamaService } from './ollama.service';
import { OpenAiProxyService } from './openai-proxy.service';
import { LlmProtocolAdapterRegistry } from './protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

export type LlmTaskType =
  | 'summary'
  | 'chapters'
  | 'tasks'
  | 'chat'
  | 'regenerate-section'
  | 'custom-prompt'
  | 'follow-up'
  | 'clip-title'
  | 'card-rollup'
  | 'card-chat'
  | 'block-ingest'
  | 'block-distill'
  | 'block-linker'
  | 'entity-resolver'
  | 'entity-merge-arbiter'
  | 'entity-graph-builder'
  | 'theme-classify'
  | 'reframing'
  | 'card-rollup-v2'
  | 'chat-v2'
  | 'goal-alignment'
  | 'dashboard-summary'
  | 'role-profile-build'
  | 'transcript-clean-refine'
  | 'behavior-refine'
  | 'meeting-quality-score'
  | 'custom-report'
  | 'chat-v2-cite-select'
  | 'chat-v2-conversation-title'
  | 'meeting-title'
  | 'regulation-extract'
  | 'regulation-dedupe'
  | 'process-template-extract'
  | 'knowledge-clone-extract'
  | 'knowledge-clone-merge'
  | 'decision-extract'
  | 'decision-supersede-detect'
  | 'insight-extract'
  | 'insight-link-to-decisions'
  | 'idea-extract'
  | 'idea-cluster-merge'
  | 'probe-formulate'
  | 'idea-status-summarize'
  | 'probe-response-classify'
  | 'debate-decision-supersede'
  | 'debate-decision-supersede-critic'
  | 'debate-decision-supersede-supporter'
  | 'debate-decision-supersede-neutral'
  | 'debate-curation-verify'
  | 'debate-curation-verify-critic'
  | 'debate-curation-verify-supporter'
  | 'debate-curation-verify-neutral'
  | 'debate-conflict-arbiter'
  | 'debate-conflict-arbiter-critic'
  | 'debate-conflict-arbiter-supporter'
  | 'debate-conflict-arbiter-neutral'
  | 'skill-trait-detect'
  | 'skill-trait-merge'
  | 'skill-trait-verify'
  | 'executable-persona-compile'
  | 'clone-respond'
  | 'skill-trait-concept-name'
  | 'role-principle-synthesize'
  | 'value-motivation-detect'
  | 'process-marker-detect'
  | 'cdm-case-interview'
  | 'persona-behavior-judge'
  | 'dialog-classify'
  | 'dialog-multi-query'
  | 'dialog-summarize'
  | 'dialog-extract-plan'
  | 'support-clone-draft'
  | 'support-answer-critic'
  | 'support-edit-classify'
  | 'support-contour-curate'
  | 'dialog-multi-query-clone'
  | 'process-template-extract'
  | 'axis-classify'
  | 'router-fallback'
  | 'brand-voice-extract'
  | 'cross-functional-friction-summary'
  | 'role-map-extract'
  | 'role-completeness-rationale'
  | 'experiment-extract'
  | 'experiment-summarize-lessons'
  | 'concierge-respond'
  | 'concierge-toolcall-validate'
  | 'assistant-confirm-classify'
  | 'checkin-parse'
  | 'operations-summary'
  | 'checkin-sentiment'
  | 'checkin-sentiment-batch'
  | 'operations-weekly-digest'
  | 'operations-daily-digest'
  | 'customer-risk-digest'
  | 'personal-brief-hint'
  | 'blocker-synthesis-summary'
  | 'value-recap-narrative'
  | 'commitment-extract-dates'
  | 'commitment-extract-status'
  | 'orchestrator-plan'
  | 'orchestrator-subagent'
  | 'orchestrator-synthesize'
  | 'orchestrator-verify'
  | 'proactive-message-craft'
  | 'helpfulness-detect'
  | 'helpfulness-trait-merge'
  | 'helpfulness-spotlight-formulate'
  | 'recognition-formulate'
  | 'issue-infer-fields'
  | 'issue-goal-suggest'
  | 'meeting-extract-actions'
  | 'intake-auto-triage'
  | 'telegram-create-task'
  | 'telegram-forward-to-task'
  | 'telegram-reply-classify'
  | 'telegram-digest-formulate'
  | 'meeting-report-fast'
  | 'knowledge-specialists-combined'
  | 'fact-supersede-detect'
  | 'sprint-helper-suggest'
  | 'sprint-review-summary'
  | 'feedback.cluster'
  | 'autorule-extract'
  | 'concierge-step-prm'
  | 'practice-skill-extract'
  | 'practice-skill-adversarial-verify'
  | 'team-health-analyzer'
  | 'reflection-quality-scorer'
  | 'hr-recommender'
  | 'meeting-speaker-analyzer'
  | 'forecast-weekly'
  | 'sprint-daily-digest'
  | 'sprint-weekly-digest'
  | 'goal-vector-tracker'
  | 'decision-hygiene'
  | 'table-infer-schema'
  | 'table-architect-pass'
  | 'table-entity-check'
  | 'table-extract-rows'
  | 'table-auto-fill'
  | 'table-semantic-filter'
  | 'goal-extract'
  | 'goal-hierarchy-link'
  | 'goals-pulse-summarize'
  | 'chatbox-summary'
  | 'task-dedupe'
  | 'goal-task-link'
  | 'document-attribution-suggest'
  | 'client-meeting-split'
  | 'compile-org-document';

export const ALL_LLM_TASK_TYPES: readonly LlmTaskType[] = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
  'card-rollup',
  'card-chat',
  'block-ingest',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'entity-merge-arbiter',
  'entity-graph-builder',
  'theme-classify',
  'reframing',
  'card-rollup-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
  'role-profile-build',
  'transcript-clean-refine',
  'behavior-refine',
  'meeting-quality-score',
  'custom-report',
  'chat-v2-cite-select',
  'chat-v2-conversation-title',
  'meeting-title',
  'regulation-extract',
  'regulation-dedupe',
  'knowledge-clone-extract',
  'knowledge-clone-merge',
  'decision-extract',
  'decision-supersede-detect',
  'insight-extract',
  'insight-link-to-decisions',
  'idea-extract',
  'idea-cluster-merge',
  'probe-formulate',
  'idea-status-summarize',
  'probe-response-classify',
  'debate-decision-supersede',
  'debate-decision-supersede-critic',
  'debate-decision-supersede-supporter',
  'debate-decision-supersede-neutral',
  'debate-curation-verify',
  'debate-curation-verify-critic',
  'debate-curation-verify-supporter',
  'debate-curation-verify-neutral',
  'debate-conflict-arbiter',
  'debate-conflict-arbiter-critic',
  'debate-conflict-arbiter-supporter',
  'debate-conflict-arbiter-neutral',
  'skill-trait-detect',
  'skill-trait-merge',
  'skill-trait-verify',
  'executable-persona-compile',
  'clone-respond',
  'skill-trait-concept-name',
  'role-principle-synthesize',
  'value-motivation-detect',
  'process-marker-detect',
  'cdm-case-interview',
  'persona-behavior-judge',
  'dialog-classify',
  'dialog-multi-query',
  'dialog-summarize',
  'dialog-extract-plan',
  'support-clone-draft',
  'support-answer-critic',
  'support-edit-classify',
  'support-contour-curate',
  'process-template-extract',
  'axis-classify',
  'router-fallback',
  'brand-voice-extract',
  'cross-functional-friction-summary',
  'role-map-extract',
  'role-completeness-rationale',
  'concierge-respond',
  'concierge-toolcall-validate',
  'assistant-confirm-classify',
  'checkin-parse',
  'operations-summary',
  'checkin-sentiment',
  'operations-weekly-digest',
  'operations-daily-digest',
  'customer-risk-digest',
  'personal-brief-hint',
  'blocker-synthesis-summary',
  'value-recap-narrative',
  'commitment-extract-dates',
  'commitment-extract-status',
  'orchestrator-plan',
  'orchestrator-subagent',
  'orchestrator-synthesize',
  'orchestrator-verify',
  'proactive-message-craft',
  'helpfulness-detect',
  'helpfulness-trait-merge',
  'helpfulness-spotlight-formulate',
  'recognition-formulate',
  'issue-infer-fields',
  'issue-goal-suggest',
  'meeting-extract-actions',
  'intake-auto-triage',
  'telegram-create-task',
  'telegram-forward-to-task',
  'telegram-reply-classify',
  'telegram-digest-formulate',
  'meeting-report-fast',
  'fact-supersede-detect',
  'feedback.cluster',
  'sprint-helper-suggest',
  'sprint-review-summary',
  'autorule-extract',
  'concierge-step-prm',
  'practice-skill-extract',
  'practice-skill-adversarial-verify',
  'team-health-analyzer',
  'reflection-quality-scorer',
  'hr-recommender',
  'meeting-speaker-analyzer',
  'forecast-weekly',
  'sprint-daily-digest',
  'sprint-weekly-digest',
  'goal-vector-tracker',
  'decision-hygiene',
  'table-infer-schema',
  'table-architect-pass',
  'table-entity-check',
  'table-extract-rows',
  'table-auto-fill',
  'table-semantic-filter',
  'goal-extract',
  'goal-hierarchy-link',
  'goals-pulse-summarize',
  'chatbox-summary',
  'knowledge-specialists-combined',
  'dialog-multi-query-clone',
  'checkin-sentiment-batch',
  'experiment-extract',
  'experiment-summarize-lessons',
  'task-dedupe',
  'goal-task-link',
  'document-attribution-suggest',
  'client-meeting-split',
  'compile-org-document',
] as const;

export type LlmProviderName =
  | 'anthropic'
  | 'minimax'
  | 'openai-via-proxy'
  | 'deepseek'
  | 'ollama'
  | 'kie'
  | 'grsai';

const ALL_PROVIDERS: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
  'kie',
  'grsai',
];

const PROVIDER_CAPABILITY: Record<
  LlmProviderName,
  { maxDataClass: DataClass; localOnly: boolean }
> = {
  anthropic: { maxDataClass: 'sensitive', localOnly: false },
  minimax: { maxDataClass: 'internal', localOnly: false },
  'openai-via-proxy': { maxDataClass: 'internal', localOnly: false },
  deepseek: { maxDataClass: 'internal', localOnly: false },
  ollama: { maxDataClass: 'private', localOnly: true },
  kie: { maxDataClass: 'private', localOnly: false },
  grsai: { maxDataClass: 'internal', localOnly: false },
};

const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

export function maxDataClass(classes: Array<DataClass | null | undefined>): DataClass {
  let best: DataClass = 'internal';
  for (const c of classes) {
    if (!c) continue;
    if (DATA_CLASS_RANK[c] > DATA_CLASS_RANK[best]) {
      best = c;
    }
  }
  return best;
}

const DEFAULT_FALLBACK_CHAIN: ProviderEntry[] = [
  { provider: 'deepseek', tier: 'primary' },
  { provider: 'openai-via-proxy', tier: 'secondary' },
  { provider: 'kie', model: 'gemini-3.1-pro', tier: 'tertiary' },
];

const TIER_RANK: Record<LlmRouteTier, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

interface ProviderEntry {
  provider: LlmProviderName;
  model?: string;
  tier?: LlmRouteTier;
}

interface ExperimentConfig {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
}

interface PriceCacheEntry {
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
  fetchedAt: number;
}

interface GepaCandidateEntry {
  promptKey: string;
  tenantId: string | null;
  promptText: string;
  abTrafficShare: number;
}

const PRICE_CACHE_TTL_MS = 60_000;

export interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  tenantId: string | null;
  meetingId?: string;
  userId?: string;
  jobId?: string;
  responseFormat?: LlmResponseFormat;
  reasoningEffort?: LlmReasoningEffort;
  maxTokens?: number;
  model?: string;
  sourceRef?: { type: string; id: string } | null;
  dataClass?: DataClass;
  tools?: LlmTool[];
  validate?: (text: string) => boolean;
  timeoutMs?: number;
}

export interface LlmCallResult {
  text: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  tier?: LlmRouteTier | null;
  providerUsed?: string;
  toolCalls?: LlmToolCall[];
}

export class LlmRouterAllProvidersFailedError extends Error {
  constructor(
    readonly taskType: LlmTaskType,
    readonly errors: Array<{ provider: string; message: string }>,
  ) {
    super(
      `LlmRouter: все провайдеры упали для taskType=${taskType}: ` +
        errors.map((e) => `${e.provider}=${e.message}`).join('; '),
    );
    this.name = 'LlmRouterAllProvidersFailedError';
  }
}

export class NoEligibleProviderError extends Error {
  readonly code = 'no_provider_for_data_class';
  constructor(
    readonly taskType: LlmTaskType,
    readonly dataClass: DataClass,
    readonly attemptedProviders: string[],
  ) {
    super(
      `LlmRouter: ни один провайдер не поддерживает dataClass='${dataClass}' для taskType='${taskType}'. ` +
        `Кандидаты: ${attemptedProviders.join(', ') || '(none)'}.`,
    );
    this.name = 'NoEligibleProviderError';
  }
}

export class LlmBudgetExceededError extends Error {
  readonly code = 'llm_budget_exceeded';
  constructor(
    readonly tenantId: string | null,
    readonly mtdRub: number,
    readonly capRub: number | null,
  ) {
    super(
      `LlmRouter: бюджет тенанта превышен (MTD=${mtdRub}₽ ≥ cap=${capRub}₽), вызов заблокирован.`,
    );
    this.name = 'LlmBudgetExceededError';
  }
}

@Injectable()
export class LlmRouterService implements OnModuleInit {
  private readonly logger = new Logger(LlmRouterService.name);
  private routes = new Map<LlmTaskType, ProviderEntry[]>();
  private allRoutes: LlmTaskRoute[] = [];
  private priceCache = new Map<string, PriceCacheEntry>();

  private gepaCandidates = new Map<string, GepaCandidateEntry>();

  private get dispatchTimeoutMs(): number {
    return this.cfg?.llmRouter?.dispatchTimeoutMs ?? 300_000;
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Inject(KieService) private readonly kie: KieService,
    @Inject(GrsaiService) private readonly grsai: GrsaiService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(LlmProtocolAdapterRegistry)
    private readonly adapterRegistry?: LlmProtocolAdapterRegistry,
    @Optional()
    @Inject(ProviderInfoResolver)
    private readonly providerInfo?: ProviderInfoResolver,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
    @Optional()
    @Inject(BudgetGuardService)
    private readonly budgetGuard?: BudgetGuardService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache().catch((err) => {
      this.logger.warn(
        `onModuleInit: не удалось загрузить routes: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async refreshCacheTick(): Promise<void> {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(`refreshCacheTick: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async refreshCache(): Promise<void> {
    const all = await this.prisma.llmTaskRoute.findMany();
    this.allRoutes = all;
    const map = new Map<LlmTaskType, ProviderEntry[]>();

    const tieredByTask = new Map<LlmTaskType, LlmTaskRoute[]>();
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue;
      if (r.tier == null || r.providerName == null) continue;
      const list = tieredByTask.get(r.taskType as LlmTaskType) ?? [];
      list.push(r);
      tieredByTask.set(r.taskType as LlmTaskType, list);
    }
    for (const [taskType, list] of tieredByTask.entries()) {
      const sorted = list
        .slice()
        .sort((a, b) => {
          const ta = TIER_RANK[a.tier as LlmRouteTier];
          const tb = TIER_RANK[b.tier as LlmRouteTier];
          if (ta !== tb) return ta - tb;
          return a.priority - b.priority;
        })
        .filter((r) => (ALL_PROVIDERS as string[]).includes(r.providerName ?? ''))
        .map((r) => ({
          provider: r.providerName as LlmProviderName,
          ...(r.model ? { model: r.model } : {}),
          tier: r.tier as LlmRouteTier,
        }));
      if (sorted.length > 0) {
        map.set(taskType, sorted);
      }
    }

    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue;
      if (r.tier != null) continue;
      if (map.has(r.taskType as LlmTaskType)) continue;
      const providers = parseProviders(r.providers);
      if (providers.length === 0) continue;
      map.set(r.taskType as LlmTaskType, providers);
    }
    this.routes = map;

    try {
      const candidates = await (
        this.prisma as unknown as {
          promptCandidate?: {
            findMany: (args: unknown) => Promise<
              Array<{
                promptKey: string;
                tenantId: string | null;
                promptText: string;
                abTrafficShare: number | null;
              }>
            >;
          };
        }
      ).promptCandidate?.findMany({
        where: { status: 'testing' },
        select: {
          promptKey: true,
          tenantId: true,
          promptText: true,
          abTrafficShare: true,
        },
      });
      const gepaMap = new Map<string, GepaCandidateEntry>();
      for (const c of candidates ?? []) {
        const key = `${c.promptKey}::${c.tenantId ?? 'null'}`;
        if (gepaMap.has(key)) continue;
        gepaMap.set(key, {
          promptKey: c.promptKey,
          tenantId: c.tenantId,
          promptText: c.promptText,
          abTrafficShare: c.abTrafficShare ?? 0.1,
        });
      }
      this.gepaCandidates = gepaMap;
    } catch (err) {
      this.logger.debug(
        `refreshCache: gepa candidates skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.debug(
      `refreshCache: загружено ${map.size} routes, ${this.gepaCandidates.size} gepa-candidates`,
    );
  }

  private pickGepaCandidate(
    taskType: LlmTaskType,
    tenantId: string | null,
    sampleSeed?: string,
  ): GepaCandidateEntry | undefined {
    const perTenantKey = `${taskType}::${tenantId ?? 'null'}`;
    const globalKey = `${taskType}::null`;
    const candidate =
      this.gepaCandidates.get(perTenantKey) ??
      (tenantId !== null ? this.gepaCandidates.get(globalKey) : undefined);
    if (!candidate) return undefined;

    const seed = sampleSeed ?? `${Date.now()}-${Math.random()}`;
    const hash = simpleHash(`${taskType}::${tenantId ?? 'null'}::${seed}`);
    const bucket = hash % 100;
    const threshold = Math.round(candidate.abTrafficShare * 100);
    return bucket < threshold ? candidate : undefined;
  }

  async getRoutes(): Promise<LlmTaskRoute[]> {
    return [...this.allRoutes];
  }

  async setRoute(args: {
    taskType: LlmTaskType;
    providers: LlmProviderName[];
    isActive: boolean;
  }): Promise<LlmTaskRoute> {
    const valid = args.providers.filter((p) =>
      (ALL_PROVIDERS as string[]).includes(p),
    ) as LlmProviderName[];
    if (valid.length === 0) {
      throw new Error(`setRoute: пустой список валидных провайдеров для ${args.taskType}`);
    }
    const existing = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });
    const updated = existing
      ? await this.prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        })
      : await this.prisma.llmTaskRoute.create({
          data: {
            taskType: args.taskType,
            tenantId: null,
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        });
    await this.refreshCache();
    return updated;
  }

  async call(params: LlmCallParams): Promise<LlmCallResult> {
    const route = this.allRoutes.find(
      (r) => r.taskType === params.taskType && r.tenantId === null && r.isActive,
    );
    const effectiveDataClass = this.resolveEffectiveDataClass(route, params.dataClass);
    const { providers, experimentGroup: baseExperimentGroup } = this.chooseProviders(route, params);

    const gepaCandidate = this.pickGepaCandidate(params.taskType, params.tenantId);
    let effectiveSystemPrompt = params.systemPrompt;
    let experimentGroup: 'A' | 'B' | 'gepa_candidate' | null = baseExperimentGroup;
    if (gepaCandidate) {
      effectiveSystemPrompt = gepaCandidate.promptText;
      experimentGroup = 'gepa_candidate';
    }
    const effectiveParams: LlmCallParams =
      effectiveSystemPrompt === params.systemPrompt
        ? params
        : { ...params, systemPrompt: effectiveSystemPrompt };

    const filtered = providers.filter((entry) => {
      const cap = PROVIDER_CAPABILITY[entry.provider];
      return DATA_CLASS_RANK[cap.maxDataClass] >= DATA_CLASS_RANK[effectiveDataClass];
    });

    if (filtered.length === 0) {
      this.metrics?.incCoreDataClassViolation({
        taskType: params.taskType,
        attemptedClass: effectiveDataClass,
      });
      this.logger.error(
        {
          taskType: params.taskType,
          dataClass: effectiveDataClass,
          attempted: providers.map((p) => p.provider),
        },
        'LlmRouter: no eligible provider for dataClass — block dispatch',
      );
      throw new NoEligibleProviderError(
        params.taskType,
        effectiveDataClass,
        providers.map((p) => p.provider),
      );
    }

    const bev = await this.budgetGuard?.evaluate(params.tenantId).catch(() => null);
    if (bev?.over) {
      const enforce =
        (await this.cfg?.getDynamic<boolean>('llm.budget.enforce_enabled', undefined, false)) ??
        false;
      this.metrics?.incLlmBudgetExceeded({ mode: enforce ? 'enforce' : 'observe' });
      if (enforce) {
        throw new LlmBudgetExceededError(params.tenantId, bev.mtdRub, bev.capRub);
      }
      this.logger.warn(
        { tenantId: params.tenantId, mtdRub: bev.mtdRub, capRub: bev.capRub },
        'LlmRouter: бюджет превышен, но enforce выключен — пропускаю (observe)',
      );
    }

    const errors: Array<{ provider: string; message: string }> = [];
    const overallStartedAt = Date.now();
    let lastFailTier: LlmRouteTier | null = null;

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i] as ProviderEntry;
      const startedAt = Date.now();
      const effectiveTier: LlmRouteTier =
        entry.tier ?? (i === 0 ? 'primary' : i === 1 ? 'secondary' : 'tertiary');
      const fallbackReason: string | null =
        i === 0
          ? null
          : `${lastFailTier ?? 'primary'}_${classifyError(errors[errors.length - 1]?.message ?? 'error')}`;
      try {
        const effectiveTimeoutMs = params.timeoutMs ?? this.dispatchTimeoutMs;
        const out = await Promise.race([
          this.dispatch(entry, effectiveParams),
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `LLM dispatch timeout: ${entry.provider}/${entry.model} > ${effectiveTimeoutMs}ms`,
                  ),
                ),
              effectiveTimeoutMs,
            ),
          ),
        ]);
        if (params.validate && !params.validate(out.text)) {
          this.metrics?.incLlmRouterDispatch({
            taskType: params.taskType,
            provider: entry.provider,
            status: 'invalid_output',
          });
          throw new LlmInvalidOutputError(
            `${entry.provider}/${entry.model ?? ''}: ответ не прошёл validate caller'а`,
            out.text,
          );
        }
        const durationMs = Date.now() - startedAt;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: 'success',
        });
        const cachedTokens = out.cachedTokens ?? 0;
        const cacheCreationTokens = out.cacheCreationTokens ?? 0;
        const costUsd = await this.computeCostUsd(
          out.provider,
          out.model,
          out.inputTokens,
          out.outputTokens,
          cachedTokens,
        );
        const invocationId = await this.usage.record({
          tenantId: params.tenantId,
          meetingId: params.meetingId ?? null,
          userId: params.userId ?? null,
          taskType: params.taskType,
          agentType: this.taskTypeToAgentType(params.taskType),
          jobId: params.jobId ?? null,
          model: out.model,
          provider: out.provider,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          cacheCreationTokens,
          costUsd,
          durationMs,
          success: true,
          sourceRef: params.sourceRef ?? null,
          experimentGroup,
          tier: effectiveTier,
          fallbackReason,
          requestPreview: this.buildRequestPreview(effectiveSystemPrompt, params.userMessage),
          responsePreview: out.text,
        });

        if (invocationId && params.tenantId && this.events) {
          this.events.emit('ai.invocation.completed', {
            invocationId,
            tenantId: params.tenantId,
            promptKey: params.taskType,
            promptVersion: `${out.provider}:${out.model}`,
            input: {
              systemPrompt: effectiveSystemPrompt,
              userMessage: params.userMessage,
            },
            output: out.text,
          });
        }
        this.logger.log(
          {
            taskType: params.taskType,
            provider: entry.provider,
            model: out.model,
            durationMs,
            inputTokens: out.inputTokens,
            outputTokens: out.outputTokens,
            cachedTokens,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            meetingId: params.meetingId,
          },
          'LlmRouter dispatch success',
        );
        return {
          text: out.text,
          modelUsed: `${out.provider}:${out.model}`,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          durationMs: Date.now() - overallStartedAt,
          tier: effectiveTier,
          providerUsed: out.provider,
          ...(out.toolCalls && out.toolCalls.length > 0 ? { toolCalls: out.toolCalls } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: entry.provider, message });
        lastFailTier = effectiveTier;
        const isLast = i === filtered.length - 1;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: isLast ? 'failed' : 'fallback',
        });
        this.logger.warn(
          {
            taskType: params.taskType,
            provider: entry.provider,
            durationMs: Date.now() - startedAt,
            isLast,
            tier: effectiveTier,
          },
          `LlmRouter dispatch ${isLast ? 'failed' : 'fallback'}: ${message}`,
        );
        if (isLast) {
          await this.usage.record({
            tenantId: params.tenantId,
            meetingId: params.meetingId ?? null,
            userId: params.userId ?? null,
            taskType: params.taskType,
            agentType: this.taskTypeToAgentType(params.taskType),
            jobId: params.jobId ?? null,
            model: entry.model ?? params.model ?? 'unknown',
            provider: this.providerNameToUsageProvider(entry.provider),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: Date.now() - startedAt,
            success: false,
            errorText: message,
            sourceRef: params.sourceRef ?? null,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            requestPreview: this.buildRequestPreview(effectiveSystemPrompt, params.userMessage),
            responsePreview: null,
          });
        }
      }
    }

    this.metrics?.incCoreLlmNoProvider?.({ taskType: params.taskType });
    throw new LlmRouterAllProvidersFailedError(params.taskType, errors);
  }

  async resolveTenantByMeeting(meetingId: string): Promise<string | null> {
    const m = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { tenantId: true },
    });
    return m?.tenantId ?? null;
  }

  async resolveTenantByUser(userId: string): Promise<string | null> {
    const m = await this.prisma.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return m?.orgId ?? null;
  }

  private resolveEffectiveDataClass(
    route: LlmTaskRoute | undefined,
    callerClass: DataClass | undefined,
  ): DataClass {
    const fromCaller: DataClass = callerClass ?? 'internal';
    const fromRoute: DataClass = route?.requiredDataClass ?? 'internal';
    return DATA_CLASS_RANK[fromCaller] >= DATA_CLASS_RANK[fromRoute] ? fromCaller : fromRoute;
  }

  private chooseProviders(
    route: LlmTaskRoute | undefined,
    params: LlmCallParams,
  ): { providers: ProviderEntry[]; experimentGroup: 'A' | 'B' | null } {
    if (route?.experiment) {
      const exp = route.experiment as ExperimentConfig;
      const now = Date.now();
      const startedAt = exp.startedAt ? Date.parse(exp.startedAt) : Number.NaN;
      const endsAt = exp.endsAt ? Date.parse(exp.endsAt) : Number.NaN;
      const inWindow =
        Number.isFinite(startedAt) && Number.isFinite(endsAt) && now >= startedAt && now < endsAt;
      if (exp.enabled === true && inWindow && exp.modelA && exp.modelB) {
        const splitPercent = typeof exp.splitPercent === 'number' ? exp.splitPercent : 50;
        const pickA = Math.random() * 100 < splitPercent;
        const pick = pickA ? exp.modelA : exp.modelB;
        const entry = parseProviderModelString(pick);
        if (entry) {
          this.logger.debug(`experiment ${params.taskType}: group=${pickA ? 'A' : 'B'} → ${pick}`);
          return { providers: [entry], experimentGroup: pickA ? 'A' : 'B' };
        }
      }
    }
    const cached = this.routes.get(params.taskType);
    if (cached && cached.length > 0) {
      return { providers: cached, experimentGroup: null };
    }
    return { providers: DEFAULT_FALLBACK_CHAIN, experimentGroup: null };
  }

  private async dispatch(entry: ProviderEntry, params: LlmCallParams): Promise<LlmCompleteOutput> {
    const effectiveModel = params.model ?? entry.model;
    const input: LlmCompleteInput = {
      system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
      user: params.userMessage,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      ...(params.responseFormat !== undefined ? { responseFormat: params.responseFormat } : {}),
      ...(params.reasoningEffort !== undefined ? { reasoningEffort: params.reasoningEffort } : {}),
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
    };
    const useRegistry =
      this.cfg?.budget?.useProtocolAdapterRegistry === true &&
      this.adapterRegistry !== undefined &&
      this.providerInfo !== undefined;
    if (useRegistry) {
      const resolved = await this.providerInfo!.resolveByName(entry.provider);
      if (resolved) {
        const adapter = this.adapterRegistry!.resolve(resolved.protocolKind);
        return adapter.complete({ provider: resolved.info, input });
      }
      this.logger.warn(
        `LlmRouter: ProviderInfoResolver не нашёл провайдера ${entry.provider}; fallback на legacy switch`,
      );
    }
    switch (entry.provider) {
      case 'anthropic':
        return this.anthropic.complete(input);
      case 'minimax':
        return this.minimax.complete(input);
      case 'openai-via-proxy':
        return this.openai.complete(input);
      case 'deepseek':
        return this.deepseek.complete(input);
      case 'ollama':
        return this.ollama.complete(input);
      case 'kie':
        return this.kie.complete(input);
      case 'grsai':
        return this.grsai.complete(input);
      default: {
        const _exhaustive: never = entry.provider;
        throw new Error(`LlmRouter: неизвестный провайдер ${String(_exhaustive)}`);
      }
    }
  }

  private async computeCostUsd(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): Promise<number> {
    const key = `${provider}:${model}`;
    const cached = this.priceCache.get(key);
    const now = Date.now();
    let entry: PriceCacheEntry | null = null;
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      entry = cached;
    } else {
      try {
        const fromDb = await this.prisma.llmModelPrice.findFirst({
          where: {
            provider,
            model,
            effectiveFrom: { lte: new Date(now) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(now) } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (fromDb) {
          entry = {
            inputPer1M: Number(fromDb.inputCostPerMillionTokens),
            outputPer1M: Number(fromDb.outputCostPerMillionTokens),
            cachedPer1M: Number(fromDb.cachedCostPerMillionTokens),
            fetchedAt: now,
          };
          this.priceCache.set(key, entry);
        }
      } catch (err) {
        this.logger.warn(
          `computeCostUsd: db lookup failed (${key}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (entry) {
      const fullInputTokens = Math.max(0, inputTokens - cachedTokens);
      const cost =
        (fullInputTokens / 1_000_000) * entry.inputPer1M +
        (cachedTokens / 1_000_000) * entry.cachedPer1M +
        (outputTokens / 1_000_000) * entry.outputPer1M;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    if (!(model in MODEL_PRICES)) {
      this.logger.warn(
        `computeCostUsd: цена для ${key} не найдена ни в БД, ни в коде → costUsd=0 (заполни в админке)`,
      );
      this.metrics?.incLlmCostUnpriced({ provider, model });
    }
    return calcCostUsd(model, inputTokens, outputTokens, cachedTokens);
  }

  private taskTypeToAgentType(
    taskType: LlmTaskType,
  ): 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' {
    switch (taskType) {
      case 'summary':
        return 'summary';
      case 'tasks':
        return 'tasks';
      case 'follow-up':
        return 'follow-up';
      default:
        return 'custom';
    }
  }

  private providerNameToUsageProvider(
    p: LlmProviderName,
  ): 'anthropic' | 'minimax' | 'openai-via-proxy' | 'deepseek' | 'ollama' | 'kie' | 'grsai' {
    return p;
  }

  private buildRequestPreview(systemPrompt: string, userMessage: string): string {
    return `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMessage}`;
  }

  refreshPrices(): void {
    this.priceCache.clear();
  }
}

function parseProviders(raw: unknown): ProviderEntry[] {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { providers?: unknown }).providers)
  ) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: ProviderEntry[] = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string') {
      if ((ALL_PROVIDERS as string[]).includes(item)) {
        result.push({ provider: item as LlmProviderName });
      }
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const providerRaw = (item as { provider?: unknown }).provider;
      const modelRaw = (item as { model?: unknown }).model;
      if (typeof providerRaw === 'string' && (ALL_PROVIDERS as string[]).includes(providerRaw)) {
        result.push({
          provider: providerRaw as LlmProviderName,
          ...(typeof modelRaw === 'string' && modelRaw.length > 0 ? { model: modelRaw } : {}),
        });
      }
    }
  }
  return result;
}

function parseProviderModelString(s: string): ProviderEntry | null {
  const idx = s.indexOf(':');
  if (idx <= 0 || idx === s.length - 1) return null;
  const provider = s.slice(0, idx);
  const model = s.slice(idx + 1);
  if (!(ALL_PROVIDERS as string[]).includes(provider)) return null;
  return { provider: provider as LlmProviderName, model };
}

function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (/(timeout|timed out|etimedout|deadline)/.test(m)) return 'timeout';
  if (/(429|rate.?limit|too many requests|quota)/.test(m)) return 'rate_limit';
  if (/(401|403|unauthorized|forbidden|invalid.*key|api[_ ]?key)/.test(m)) return 'auth';
  if (/(econn|enotfound|eai_again|socket hang up|fetch failed|network)/.test(m)) return 'network';
  if (/5\d\d/.test(m)) return 'server_5xx';
  return 'error';
}

function simpleHash(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}
