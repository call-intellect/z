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
  meetingId?: string | null;
  agentType: AiAgentType;
  jobId?: string | null;
  model: string;
  provider: AiProvider;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number | null;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText?: string | null;
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
          meetingId: input.meetingId ?? null,
          agentType: input.agentType,
          jobId: input.jobId ?? null,
          model: input.model,
          provider: input.provider,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          ...(input.reasoningTokens !== undefined && input.reasoningTokens !== null
            ? { reasoningTokens: input.reasoningTokens }
            : {}),
          costUsd: new Prisma.Decimal(input.costUsd.toFixed(6)),
          durationMs: input.durationMs,
          success: input.success,
          errorText: input.errorText ?? null,
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
