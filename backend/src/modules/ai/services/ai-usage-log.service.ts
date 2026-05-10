import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

export type AiAgentType =
  | 'transcribe'
  | 'summary'
  | 'report-by-type'
  | 'follow-up'
  | 'tasks'
  | 'custom';

export type AiProvider = 'anthropic' | 'vox' | 'openai' | 'minimax' | 'openai-via-proxy';

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
  reasoningTokens?: number | null;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText?: string | null;
  /** {type, id} — drill-down ссылка для Z-Admin. */
  sourceRef?: { type: string; id: string } | null;
  /** A/B-эксперимент LlmTaskRoute.experiment: 'A' | 'B'. NULL = вне эксперимента. */
  experimentGroup?: string | null;
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

  async record(input: RecordAiUsageInput): Promise<void> {
    try {
      await this.prisma.aiUsageLog.create({
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
        },
      });

      if (input.costUsd > 0) {
        this.metrics.addAiCostUsd(input.costUsd);
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
  }
}
