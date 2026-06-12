import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type LlmRouteTier } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

export type AiAgentType =
  | 'transcribe'
  | 'summary'
  | 'report-by-type'
  | 'follow-up'
  | 'tasks'
  | 'custom'
  // Волна 4 B0 — нейтральный протокол встречи наружу для клиента
  // (client-meeting-split, free-text).
  | 'client_protocol';

export type AiProvider =
  | 'anthropic'
  | 'vox'
  | 'openai'
  | 'minimax'
  | 'openai-via-proxy'
  | 'deepseek'
  | 'ollama'
  | 'kie'
  | 'grsai';

export interface RecordAiUsageInput {
  /** Org, на которую списывается стоимость. NULL только для глобальных system jobs. */
  tenantId?: string | null;
  meetingId?: string | null;
  userId?: string | null;
  /** Полное имя taskType (chapters, summary, card-rollup, etc). */
  taskType?: string | null;
  agentType: AiAgentType;
  jobId?: string | null;
  model: string;
  provider: AiProvider;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  /**
   * T7-F3 — токенов записано в кеш этим вызовом (Anthropic
   * `cache_creation_input_tokens`). Только информативно (нет колонки в БД,
   * нужно только для метрики). 0 для большинства провайдеров.
   */
  cacheCreationTokens?: number;
  reasoningTokens?: number | null;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText?: string | null;
  /** {type, id} — drill-down ссылка для Z-Admin. */
  sourceRef?: { type: string; id: string } | null;
  /** A/B-эксперимент LlmTaskRoute.experiment: 'A' | 'B'. NULL = вне эксперимента. */
  experimentGroup?: string | null;
  /**
   * Фаза A.4 — фактический уровень цепочки моделей: primary / secondary / tertiary.
   * NULL для legacy-вызовов или legacy-цепочек без явных tier'ов.
   */
  tier?: LlmRouteTier | string | null;
  /**
   * Фаза A.4 — причина срабатывания fallback'а (`primary_timeout` / `secondary_error`
   * / `primary_rate_limit` и т.д.). NULL для первичного успешного вызова.
   */
  fallbackReason?: string | null;
  /** Z-Admin Фаза 7: превью промпта (system+user) — truncate до 8KB. */
  requestPreview?: string | null;
  /** Z-Admin Фаза 7: превью ответа модели — truncate до 8KB. */
  responsePreview?: string | null;
}

/** Максимальный размер превью промпта/ответа в AiUsageLog (8KB). */
const PREVIEW_MAX_BYTES = 8 * 1024;

function truncatePreview(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // Точный байтовый размер UTF-8 — encode + slice по байтам, чтобы не разрезать
  // суррогатные пары. Используем TextEncoder/TextDecoder.
  const enc = new TextEncoder();
  const bytes = enc.encode(value);
  if (bytes.length <= PREVIEW_MAX_BYTES) return value;
  const dec = new TextDecoder('utf-8', { fatal: false });
  return dec.decode(bytes.slice(0, PREVIEW_MAX_BYTES));
}

/**
 * Запись телеметрии AI-вызовов в `AiUsageLog`.
 *
 *   - Один вызов LLM/ASR → одна запись.
 *   - costUsd считается ВНЕ этого сервиса (через `calcCostUsd`).
 *   - Прометей-счётчик `ai_cost_usd_total` инкрементируется здесь же —
 *     не плодим разные источники правды для биллинга.
 *
 * НЕ кидает на ошибку записи в БД (биллинг важен, но сильнее важен сам пайплайн).
 * Логирует warn — на проде разберём.
 */
@Injectable()
export class AiUsageLogService {
  private readonly logger = new Logger(AiUsageLogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async record(input: RecordAiUsageInput): Promise<string | null> {
    let createdId: string | null = null;
    try {
      const created = await this.prisma.aiUsageLog.create({
        data: {
          tenantId: input.tenantId ?? null,
          meetingId: input.meetingId ?? null,
          userId: input.userId ?? null,
          taskType: input.taskType ?? null,
          agentType: input.agentType,
          jobId: input.jobId ?? null,
          model: input.model,
          provider: input.provider,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          cachedTokens: input.cachedTokens ?? 0,
          ...(input.reasoningTokens !== undefined && input.reasoningTokens !== null
            ? { reasoningTokens: input.reasoningTokens }
            : {}),
          costUsd: new Prisma.Decimal(input.costUsd.toFixed(6)),
          durationMs: input.durationMs,
          success: input.success,
          errorText: input.errorText ?? null,
          sourceRef: input.sourceRef
            ? (input.sourceRef as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          experimentGroup: input.experimentGroup ?? null,
          tier: input.tier ?? null,
          fallbackReason: input.fallbackReason ?? null,
          requestPreview: truncatePreview(input.requestPreview),
          responsePreview: truncatePreview(input.responsePreview),
        },
        select: { id: true },
      });
      createdId = created.id;

      if (input.costUsd > 0) {
        this.metrics.addAiCostUsd(input.costUsd);
      }

      // Фаза 11 knowledge-core: метрика core_llm_tokens_total{tenant,task_type}.
      // Считаем суммарно input+output (не учитываем cached как отдельный
      // bucket — для общего usage-дашборда этого достаточно).
      if (input.tenantId && input.taskType && input.success) {
        const tokens =
          (input.inputTokens ?? 0) + (input.outputTokens ?? 0);
        if (tokens > 0) {
          this.metrics.addCoreLlmTokens({
            tenant: input.tenantId,
            taskType: input.taskType,
            tokens,
          });
        }
      }

      // T7-F3 — prompt caching метрики. Инкрементируем только на успешных
      // вызовах: failed call с cachedTokens > 0 — нонсенс (cached=0 default
      // в catch-branch'е router'а).
      if (input.success) {
        // Ф6 Часть 3 — знаменатель cache hit-ratio per provider. Инкремент на
        // КАЖДОМ успешном вызове (с кешем и без), в той же точке, что cache_hit.
        this.metrics.incLlmCall({ provider: input.provider });
        const cacheRead = input.cachedTokens ?? 0;
        const cacheCreation = input.cacheCreationTokens ?? 0;
        const taskTypeLabel = input.taskType ?? 'unknown';
        if (cacheRead > 0) {
          this.metrics.incLlmCacheHit({
            provider: input.provider,
            model: input.model,
            taskType: taskTypeLabel,
          });
          this.metrics.addLlmCacheReadTokens({
            provider: input.provider,
            model: input.model,
            tokens: cacheRead,
          });
        }
        if (cacheCreation > 0) {
          this.metrics.addLlmCacheCreationTokens({
            provider: input.provider,
            model: input.model,
            tokens: cacheCreation,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          meetingId: input.meetingId,
          agentType: input.agentType,
          model: input.model,
        },
        'AiUsageLog.record: не удалось записать использование',
      );
    }
    return createdId;
  }
}
