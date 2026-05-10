import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DataClass, LlmTaskRoute } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';
import { AnthropicService } from './anthropic.service';
import { DeepSeekService } from './deepseek.service';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmResponseFormat,
  LlmReasoningEffort,
} from './llm.types';
import { MinimaxService } from './minimax.service';
import { calcCostUsd, MODEL_PRICES } from './model-prices';
import { OllamaService } from './ollama.service';
import { OpenAiProxyService } from './openai-proxy.service';

/**
 * Семейство задач, для которых LlmRouter определяет провайдера.
 *
 * Legacy: summary/chapters/tasks/chat/regenerate-section/custom-prompt/
 * follow-up/clip-title/card-rollup/card-chat.
 *
 * Knowledge-core (Фаза 2+): block-ingest, block-distill, block-linker,
 * entity-resolver, entity-merge-arbiter, entity-graph-builder, theme-classify,
 * reframing, card-rollup-v2, task-extract-v2, chapter-extract-v2, summary-v2,
 * chat-v2, goal-alignment, dashboard-summary.
 */
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
  | 'task-extract-v2'
  | 'chapter-extract-v2'
  | 'summary-v2'
  | 'chat-v2'
  | 'goal-alignment'
  | 'dashboard-summary';

/**
 * Полный кортеж всех `LlmTaskType` — единый источник правды для DTO admin'а.
 * Должен совпадать с union'ом выше, добавляются новые taskType ОДНОВРЕМЕННО
 * в обоих местах. tsc предупредит при несоответствии (через `satisfies`-trick
 * не делаем — TS пока без `Exhaustive<T>` helper'а на runtime-tuple).
 */
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
  'task-extract-v2',
  'chapter-extract-v2',
  'summary-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
] as const;

/**
 * Имя провайдера, как оно хранится в `LlmTaskRoute.providers` (JSON-массив).
 * Для каждого провайдера в свитче ниже — соответствующий сервис.
 */
export type LlmProviderName =
  | 'anthropic'
  | 'minimax'
  | 'openai-via-proxy'
  | 'deepseek'
  | 'ollama';

const ALL_PROVIDERS: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
];

/**
 * Фаза 11 knowledge-core: per-provider capability map.
 *   - maxDataClass — самый «строгий» класс данных, который провайдер согласен
 *     обрабатывать. public < internal < sensitive < private.
 *   - localOnly — провайдер живёт локально (никогда не уходит наружу).
 *
 * `anthropic` — прямой Anthropic API; для нас это «sensitive» (договор).
 *   Если ANTHROPIC_USE_PROXY=true — фактически идёт через сторонний прокси,
 *   но capability в текущем MVP мы не понижаем (отслеживается ENV-флагом).
 * `minimax` / `openai-via-proxy` / `deepseek` — внешние, internal-only.
 * `ollama` — локальный, формально может обрабатывать private.
 *
 * Карта намеренно жёсткая — config-driven вариант (через БД) — vNext.
 */
const PROVIDER_CAPABILITY: Record<
  LlmProviderName,
  { maxDataClass: DataClass; localOnly: boolean }
> = {
  anthropic: { maxDataClass: 'sensitive', localOnly: false },
  minimax: { maxDataClass: 'internal', localOnly: false },
  'openai-via-proxy': { maxDataClass: 'internal', localOnly: false },
  deepseek: { maxDataClass: 'internal', localOnly: false },
  ollama: { maxDataClass: 'private', localOnly: true },
};

/**
 * Порядок DataClass: public < internal < sensitive < private.
 * Используется для `provider.maxDataClass >= dataClass` сравнения.
 */
const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

/**
 * Возвращает «строжайший» из переданных DataClass'ов. Используется в
 * call-site'ах LLM-вызовов, где входных блоков/документов больше одного
 * (chat retrieval, distill judge, summary v2 и т.п.). Дефолт — 'internal'.
 *
 * Пустой/отсутствующий вход → 'internal' (чтобы вызовы без явного
 * dataClass не оказывались более строгими, чем нужно).
 */
export function maxDataClass(
  classes: Array<DataClass | null | undefined>,
): DataClass {
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
  { provider: 'deepseek' },
  { provider: 'openai-via-proxy' },
  { provider: 'ollama' },
];

interface ProviderEntry {
  provider: LlmProviderName;
  model?: string;
}

/**
 * Параметры эксперимента LlmTaskRoute.experiment.
 *
 *  - modelA / modelB — `<provider>:<model>` (например `deepseek:deepseek-v4-flash`).
 *  - splitPercent: доля трафика на A в процентах (0..100).
 *  - startedAt / endsAt — ISO-строки.
 */
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

const PRICE_CACHE_TTL_MS = 60_000;

export interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  /**
   * tenantId — обязательное поле (Фаза 0 knowledge-core).
   *
   * Все вызовы LLM должны быть атрибутированы Org для биллинга/аналитики.
   * Если caller не может определить tenantId (system jobs, scheduled tasks
   * без owner) — допустимо передать null явно, но это исключение.
   */
  tenantId: string | null;
  meetingId?: string;
  userId?: string;
  jobId?: string;
  /** Структурированный вывод. */
  responseFormat?: LlmResponseFormat;
  /** Усилия модели на reasoning (для gpt-5* и deepseek-v4-pro). */
  reasoningEffort?: LlmReasoningEffort;
  maxTokens?: number;
  /**
   * Если задан — переопределяет модель провайдера. Полезно для бенчмарков
   * (одна и та же задача → разные модели).
   */
  model?: string;
  /** Указатель на источник вызова для drill-down в Z-Admin (Фаза 7). */
  sourceRef?: { type: string; id: string } | null;
  /**
   * Класс данных вызова (Фаза 11 knowledge-core).
   *
   * Определяет, какие провайдеры могут обработать запрос: только те, у
   * которых `maxDataClass >= dataClass`. Если caller не передал —
   * считаем 'internal' (большинство business-данных).
   *
   * Источник:
   *   - воркеры над блоками — max(IdeaBlock.dataClass) по входным;
   *   - chat — max по retrieval pool;
   *   - meeting-уровень — наследуем из Meeting/RawEvent.
   */
  dataClass?: DataClass;
}

export interface LlmCallResult {
  text: string;
  /** Формат: `<provider>:<model>` (e.g. `deepseek:deepseek-v4-flash`). */
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
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

/**
 * Фаза 11: ни один провайдер не подходит под требуемый dataClass.
 * Бросается, когда `provider.maxDataClass < dataClass` для всех кандидатов.
 * Caller должен либо понизить dataClass (если это допустимо политикой
 * безопасности), либо подключить локальный провайдер.
 */
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

/**
 * Маршрутизатор LLM-вызовов по `LlmTaskRoute` записям из БД.
 *
 * - При старте подгружает все routes в in-memory кэш.
 * - Раз в минуту обновляет кэш (через `@Cron('*\/1 * * * *')`).
 * - На каждый вызов: подбирает providers по `taskType` (или дефолт),
 *   пробует последовательно. Успех — пишет в `AiUsageLog` + метрика
 *   `llm_router_dispatch_total{status='success'}`. Падение — переключение
 *   с метрикой `status='fallback'`. Все упали → `status='failed'` + exception.
 * - A/B-эксперименты через `LlmTaskRoute.experiment`: при `enabled=true`
 *   и в окне `[startedAt, endsAt)` — рандомно по `splitPercent` выбираем
 *   A или B и пишем `experimentGroup` в `AiUsageLog`.
 * - Цена считается по `LlmModelPrice` (БД); при отсутствии записи — fallback
 *   на `MODEL_PRICES` из кода. Цены кэшируются в памяти на 60 секунд.
 */
@Injectable()
export class LlmRouterService implements OnModuleInit {
  private readonly logger = new Logger(LlmRouterService.name);
  private routes = new Map<LlmTaskType, ProviderEntry[]>();
  /**
   * Хранится отдельно от `routes`: при `isActive=false` маршрут игнорируется
   * (используется дефолтная цепочка), но видим в `getRoutes()` для админ-UI.
   */
  private allRoutes: LlmTaskRoute[] = [];
  private priceCache = new Map<string, PriceCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache().catch((err) => {
      this.logger.warn(
        `onModuleInit: не удалось загрузить routes: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Cron — каждую минуту синкает кэш с БД. Если админ изменил route через UI,
   * максимум 60 секунд до применения.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async refreshCacheTick(): Promise<void> {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(
        `refreshCacheTick: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Перечитать routes из БД. Вызывается из cron и из `setRoute` (немедленная
   * инвалидация после изменения).
   */
  async refreshCache(): Promise<void> {
    const all = await this.prisma.llmTaskRoute.findMany();
    this.allRoutes = all;
    const map = new Map<LlmTaskType, ProviderEntry[]>();
    for (const r of all) {
      if (!r.isActive) continue;
      const providers = parseProviders(r.providers);
      if (providers.length === 0) continue;
      // taskType хранится как строка — приводим к нашему union'у только если он валидный.
      // Иначе игнорируем (например, осколок старого ENUM'а).
      map.set(r.taskType as LlmTaskType, providers);
    }
    this.routes = map;
    this.logger.debug(`refreshCache: загружено ${map.size} routes`);
  }

  async getRoutes(): Promise<LlmTaskRoute[]> {
    return [...this.allRoutes];
  }

  /**
   * Upsert route + немедленная инвалидация кэша. `providers` — массив имён
   * провайдеров в порядке fallback'а.
   */
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

  /**
   * Главный метод. Пробует провайдеров последовательно, на любую ошибку —
   * следующий. На успех — записывает в AiUsageLog и возвращает результат.
   *
   * Фаза 11: если caller передал `params.dataClass` (или маршрут задаёт
   * `requiredDataClass`), результирующий класс данных = max двух. Затем
   * провайдеры фильтруются по `provider.maxDataClass >= effectiveClass`.
   * Если после фильтра пусто — `NoEligibleProviderError` + метрика
   * `core_data_class_violations_total` += 1.
   */
  async call(params: LlmCallParams): Promise<LlmCallResult> {
    const route = this.allRoutes.find(
      (r) => r.taskType === params.taskType && r.tenantId === null && r.isActive,
    );
    const effectiveDataClass = this.resolveEffectiveDataClass(route, params.dataClass);
    const { providers, experimentGroup } = this.chooseProviders(route, params);

    // Фаза 11: фильтр по dataClass.
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

    const errors: Array<{ provider: string; message: string }> = [];
    const overallStartedAt = Date.now();

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i] as ProviderEntry;
      const startedAt = Date.now();
      try {
        const out = await this.dispatch(entry, params);
        const durationMs = Date.now() - startedAt;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: 'success',
        });
        const cachedTokens = out.cachedTokens ?? 0;
        const costUsd = await this.computeCostUsd(
          out.provider,
          out.model,
          out.inputTokens,
          out.outputTokens,
          cachedTokens,
        );
        await this.usage.record({
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
          costUsd,
          durationMs,
          success: true,
          sourceRef: params.sourceRef ?? null,
          experimentGroup,
          // Z-Admin Фаза 7: превью промпта (system+user) и ответа для drill-down.
          // Truncate до 8KB на стороне AiUsageLogService.
          requestPreview: this.buildRequestPreview(
            params.systemPrompt,
            params.userMessage,
          ),
          responsePreview: out.text,
        });
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
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: entry.provider, message });
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
          },
          `LlmRouter dispatch ${isLast ? 'failed' : 'fallback'}: ${message}`,
        );
        // На последнем провайдере — записываем неуспешный AiUsageLog.
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
            requestPreview: this.buildRequestPreview(
              params.systemPrompt,
              params.userMessage,
            ),
            responsePreview: null,
          });
        }
      }
    }

    throw new LlmRouterAllProvidersFailedError(params.taskType, errors);
  }

  /**
   * Удобный helper: достать tenantId по meetingId. Если meeting не найден или
   * у него tenantId=null — вернёт null. Используется в воркерах AI, где
   * caller знает только meetingId.
   */
  async resolveTenantByMeeting(meetingId: string): Promise<string | null> {
    const m = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { tenantId: true },
    });
    return m?.tenantId ?? null;
  }

  /**
   * Helper: достать tenantId по userId (берём первый Membership).
   * Подходит для вызовов, не привязанных к встрече (chat cross-meeting и т.п.).
   */
  async resolveTenantByUser(userId: string): Promise<string | null> {
    const m = await this.prisma.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return m?.orgId ?? null;
  }

  // ─────────────────────────── private ─────────────────────────────────────

  /**
   * Фаза 11: вычисление эффективного dataClass'а вызова.
   *
   *   max(params.dataClass ?? 'internal', route.requiredDataClass ?? 'internal').
   *
   * Берём «строжайший» из двух: caller знает класс входных данных, маршрут
   * может задавать минимальную чувствительность задачи (например, audit-flow
   * всегда 'sensitive').
   */
  private resolveEffectiveDataClass(
    route: LlmTaskRoute | undefined,
    callerClass: DataClass | undefined,
  ): DataClass {
    const fromCaller: DataClass = callerClass ?? 'internal';
    const fromRoute: DataClass = route?.requiredDataClass ?? 'internal';
    return DATA_CLASS_RANK[fromCaller] >= DATA_CLASS_RANK[fromRoute]
      ? fromCaller
      : fromRoute;
  }

  /**
   * Решает, какую цепочку провайдеров использовать с учётом A/B-эксперимента.
   * Возвращает providers и (опционально) метку группы для AiUsageLog.
   */
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
        Number.isFinite(startedAt) &&
        Number.isFinite(endsAt) &&
        now >= startedAt &&
        now < endsAt;
      if (exp.enabled === true && inWindow && exp.modelA && exp.modelB) {
        const splitPercent = typeof exp.splitPercent === 'number' ? exp.splitPercent : 50;
        const pickA = Math.random() * 100 < splitPercent;
        const pick = pickA ? exp.modelA : exp.modelB;
        const entry = parseProviderModelString(pick);
        if (entry) {
          this.logger.debug(
            `experiment ${params.taskType}: group=${pickA ? 'A' : 'B'} → ${pick}`,
          );
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

  private async dispatch(
    entry: ProviderEntry,
    params: LlmCallParams,
  ): Promise<LlmCompleteOutput> {
    // Приоритет: явный override через params.model, иначе модель из route entry.
    const effectiveModel = params.model ?? entry.model;
    const input: LlmCompleteInput = {
      system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
      user: params.userMessage,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      ...(params.responseFormat !== undefined
        ? { responseFormat: params.responseFormat }
        : {}),
      ...(params.reasoningEffort !== undefined
        ? { reasoningEffort: params.reasoningEffort }
        : {}),
    };
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
      default: {
        const _exhaustive: never = entry.provider;
        throw new Error(`LlmRouter: неизвестный провайдер ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Стоимость вызова в USD. Сначала смотрим в `LlmModelPrice` (БД, актуальная
   * запись по effectiveFrom/effectiveTo). Если нет — fallback на код.
   * Кэшируем результат на 60 секунд, чтобы не бить БД на каждый LLM-вызов.
   */
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
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: new Date(now) } },
            ],
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

    // Fallback на статическую карту в коде.
    if (!(model in MODEL_PRICES)) {
      this.logger.debug(
        `computeCostUsd: цена для ${key} не найдена ни в БД, ни в коде → 0`,
      );
    }
    return calcCostUsd(model, inputTokens, outputTokens, cachedTokens);
  }

  /**
   * Маппинг `taskType` → `agentType` для AiUsageLog. Существующая
   * `AiAgentType` enum в `AiUsageLogService` — сохраняем совместимость.
   */
  private taskTypeToAgentType(
    taskType: LlmTaskType,
  ): 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' {
    switch (taskType) {
      case 'summary':
      case 'summary-v2':
        return 'summary';
      case 'tasks':
      case 'task-extract-v2':
        return 'tasks';
      case 'follow-up':
        return 'follow-up';
      default:
        return 'custom';
    }
  }

  private providerNameToUsageProvider(
    p: LlmProviderName,
  ): 'anthropic' | 'minimax' | 'openai-via-proxy' | 'deepseek' | 'ollama' {
    return p;
  }

  /**
   * Превью промпта для AiUsageLog (Z-Admin Фаза 7).
   * Конкатенация system + user с метками. Truncate до 8KB делает AiUsageLogService.
   */
  private buildRequestPreview(systemPrompt: string, userMessage: string): string {
    return `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMessage}`;
  }

  /**
   * Сбросить in-memory кэш цен. Вызывается из AdminPricesService при
   * изменении прайс-карты — следующий вызов прочитает свежие цены из БД.
   */
  refreshPrices(): void {
    this.priceCache.clear();
  }
}

/**
 * `LlmTaskRoute.providers` — Json. Поддерживаемые формы:
 *   - `string[]` — `['deepseek', 'openai-via-proxy']`.
 *   - `Array<{provider: string, model?: string}>` — c указанием модели.
 *   - `{providers: <одна из форм выше>}` — обёртка.
 *
 * Парсим в строгий список валидных provider+model.
 */
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
          ...(typeof modelRaw === 'string' && modelRaw.length > 0
            ? { model: modelRaw }
            : {}),
        });
      }
    }
  }
  return result;
}

/**
 * Парсит строку формата `<provider>:<model>` (используется в
 * `LlmTaskRoute.experiment.modelA/modelB`).
 */
function parseProviderModelString(s: string): ProviderEntry | null {
  const idx = s.indexOf(':');
  if (idx <= 0 || idx === s.length - 1) return null;
  const provider = s.slice(0, idx);
  const model = s.slice(idx + 1);
  if (!(ALL_PROVIDERS as string[]).includes(provider)) return null;
  return { provider: provider as LlmProviderName, model };
}
