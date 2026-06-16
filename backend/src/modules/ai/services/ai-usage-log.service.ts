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
  tenantId?: string | null;
  meetingId?: string | null;
  userId?: string | null;
  taskType?: string | null;
  agentType: AiAgentType;
  jobId?: string | null;
  model: string;
  provider: AiProvider;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number | null;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText?: string | null;
  sourceRef?: { type: string; id: string } | null;
  experimentGroup?: string | null;
  tier?: LlmRouteTier | string | null;
  fallbackReason?: string | null;
  requestPreview?: string | null;
  responsePreview?: string | null;
}

const PREVIEW_MAX_BYTES = 8 * 1024;

function truncatePreview(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const enc = new TextEncoder();
  const bytes = enc.encode(value);
  if (bytes.length <= PREVIEW_MAX_BYTES) return value;
  const dec = new TextDecoder('utf-8', { fatal: false });
  return dec.decode(bytes.slice(0, PREVIEW_MAX_BYTES));
}

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

      if (input.tenantId && input.taskType && input.success) {
        const tokens = (input.inputTokens ?? 0) + (input.outputTokens ?? 0);
        if (tokens > 0) {
          this.metrics.addCoreLlmTokens({
            tenant: input.tenantId,
            taskType: input.taskType,
            tokens,
          });
        }
      }

      if (input.success) {
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
