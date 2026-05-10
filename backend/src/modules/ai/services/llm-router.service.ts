import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LlmTaskRoute } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';
import { AnthropicService } from './anthropic.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import { MinimaxService } from './minimax.service';
import { calcCostUsd } from './model-prices';
import { OpenAiProxyService } from './openai-proxy.service';

/**
 * Семейство задач, для которых LlmRouter определяет провайдера.
 * Параллельно существующему `LlmFallbackService` — он остаётся для
 * legacy цепочки (analyze.worker → summary/report/follow-up/tasks).
 *
 * LlmRouter используется новыми сервисами фазы M3 (chapters/tasks-extract/
 * chat/regenerate-section/clip-title/follow-up при regenerate).
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
  | 'card-chat';

/**
 * Имя провайдера, как оно хранится в `LlmTaskRoute.providers` (JSON-массив).
 * Для каждого провайдера в свитче ниже — соответствующий сервис.
 */
export type LlmProviderName = 'anthropic' | 'minimax' | 'openai-via-proxy';

const ALL_PROVIDERS: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
];

const DEFAULT_FALLBACK_CHAIN: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
];

export interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  meetingId?: string;
  userId?: string;
  jobId?: string;
  /** Резервируется под будущий structured-output. Сейчас игнорируется (используются tools на уровне caller). */
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  /**
   * Если задан — переопределяет модель провайдера. Полезно для бенчмарков
   * (одна и та же задача → разные модели).
   */
  model?: string;
}

export interface LlmCallResult {
  text: string;
  /** Формат: `<provider>:<model>` (e.g. `anthropic:claude-sonnet-4-6`). */
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
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
 * Маршрутизатор LLM-вызовов по `LlmTaskRoute` записям из БД.
 *
 * - При старте подгружает все routes в in-memory кэш.
 * - Раз в минуту обновляет кэш (через `@Cron('*\/1 * * * *')`).
 * - На каждый вызов: подбирает providers по `taskType` (или дефолт),
 *   пробует последовательно. Успех — пишет в `AiUsageLog` + метрика
 *   `llm_router_dispatch_total{status='success'}`. Падение — переключение
 *   с метрикой `status='fallback'`. Все упали → `status='failed'` + exception.
 *
 * Этот сервис умышленно НЕ дублирует `LlmFallbackService` — он использует
 * существующие провайдер-сервисы напрямую, чтобы маршрутизация решалась
 * через DB-конфиг, а не код.
 */
@Injectable()
export class LlmRouterService implements OnModuleInit {
  private readonly logger = new Logger(LlmRouterService.name);
  private routes = new Map<LlmTaskType, LlmProviderName[]>();
  /**
   * Хранится отдельно от `routes`: при `isActive=false` маршрут игнорируется
   * (используется дефолтная цепочка), но видим в `getRoutes()` для админ-UI.
   */
  private allRoutes: LlmTaskRoute[] = [];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
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
    const map = new Map<LlmTaskType, LlmProviderName[]>();
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
    // Глобальный route (tenantId=null): findFirst+update/create, потому что
    // unique-составной (taskType, tenantId) с NULL Prisma в `where` напрямую
    // не разрешает. Этот метод оперирует только глобальными роутами.
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
   */
  async call(params: LlmCallParams): Promise<LlmCallResult> {
    const providers =
      this.routes.get(params.taskType) ?? DEFAULT_FALLBACK_CHAIN;

    const errors: Array<{ provider: string; message: string }> = [];
    const overallStartedAt = Date.now();

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i] as LlmProviderName;
      const startedAt = Date.now();
      try {
        const out = await this.dispatch(provider, params);
        const durationMs = Date.now() - startedAt;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider,
          status: 'success',
        });
        await this.usage.record({
          meetingId: params.meetingId ?? null,
          agentType: this.taskTypeToAgentType(params.taskType),
          jobId: params.jobId ?? null,
          model: out.model,
          provider: out.provider,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          costUsd: calcCostUsd(out.model, out.inputTokens, out.outputTokens),
          durationMs,
          success: true,
        });
        this.logger.log(
          {
            taskType: params.taskType,
            provider,
            model: out.model,
            durationMs,
            inputTokens: out.inputTokens,
            outputTokens: out.outputTokens,
            meetingId: params.meetingId,
          },
          'LlmRouter dispatch success',
        );
        return {
          text: out.text,
          modelUsed: `${out.provider}:${out.model}`,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          durationMs: Date.now() - overallStartedAt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider, message });
        const isLast = i === providers.length - 1;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider,
          status: isLast ? 'failed' : 'fallback',
        });
        this.logger.warn(
          {
            taskType: params.taskType,
            provider,
            durationMs: Date.now() - startedAt,
            isLast,
          },
          `LlmRouter dispatch ${isLast ? 'failed' : 'fallback'}: ${message}`,
        );
        // На последнем провайдере — записываем неуспешный AiUsageLog.
        if (isLast) {
          await this.usage.record({
            meetingId: params.meetingId ?? null,
            agentType: this.taskTypeToAgentType(params.taskType),
            jobId: params.jobId ?? null,
            model: params.model ?? 'unknown',
            provider: this.providerNameToUsageProvider(provider),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: Date.now() - startedAt,
            success: false,
            errorText: message,
          });
        }
      }
    }

    throw new LlmRouterAllProvidersFailedError(params.taskType, errors);
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private async dispatch(
    provider: LlmProviderName,
    params: LlmCallParams,
  ): Promise<LlmCompleteOutput> {
    const input: LlmCompleteInput = {
      system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
      user: params.userMessage,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(params.model !== undefined ? { model: params.model } : {}),
    };
    switch (provider) {
      case 'anthropic':
        return this.anthropic.complete(input);
      case 'minimax':
        return this.minimax.complete(input);
      case 'openai-via-proxy':
        return this.openai.complete(input);
      default: {
        const _exhaustive: never = provider;
        throw new Error(`LlmRouter: неизвестный провайдер ${String(_exhaustive)}`);
      }
    }
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
        return 'summary';
      case 'tasks':
        return 'tasks';
      case 'follow-up':
        return 'follow-up';
      case 'chapters':
      case 'chat':
      case 'regenerate-section':
      case 'custom-prompt':
      case 'clip-title':
      case 'card-rollup':
      case 'card-chat':
      default:
        return 'custom';
    }
  }

  private providerNameToUsageProvider(
    p: LlmProviderName,
  ): 'anthropic' | 'minimax' | 'openai-via-proxy' {
    return p;
  }
}

/**
 * `LlmTaskRoute.providers` — Json. Может быть `string[]` или `{providers: string[]}`.
 * Парсим в строгий список валидных имён.
 */
function parseProviders(raw: unknown): LlmProviderName[] {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { providers?: unknown }).providers)) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: LlmProviderName[] = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string' && (ALL_PROVIDERS as string[]).includes(item)) {
      result.push(item as LlmProviderName);
    }
  }
  return result;
}
