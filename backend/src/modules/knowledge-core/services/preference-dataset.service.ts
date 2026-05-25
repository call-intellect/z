import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Counter, register } from 'prom-client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * W2.3 KC-Temporal (2026-05-25) — `PreferenceDatasetService`.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.3.
 *
 * Слушает `curation.decision_recorded` (emit от `CurationService.decide()` —
 * см. fix в той же фазе) и для целевых decisionType пишет `LlmPreferenceSample`.
 *
 *   - `approved` / `approve` / `approve_with_edits` → label = 'correct'
 *   - `rejected` → label = 'wrong'
 *   - `rolled_back` (если будет добавлен) → label = 'wrong'
 *   - `mark_as_misleading` → label = 'misleading'
 *
 * `inputContext` извлекаем из CurationItem.proposedPayload (best-effort —
 * там лежит то, что предложил специалист 3.x). `modelOutput` — финальный
 * payload решения куратора (нужен для оценки «куда LLM ошибся»).
 *
 * Без БД-зависимостей в hot-path: только @OnEvent + одна prisma.create.
 */

/** Полезная нагрузка события `curation.decision_recorded`. */
export interface CurationDecisionRecordedEvent {
  tenantId: string;
  curationItemId: string;
  curationDecisionId: string | null;
  resourceType: string;
  resourceId: string;
  decisionType: string;
  reviewerUserId: string;
  reasoning?: string | null;
  /** Сырой payload, который предложил специалист (= вход для следующего LLM). */
  proposedPayload?: unknown;
}

/** Маппинг decisionType → label (или null, если запись не нужна). */
function decisionTypeToLabel(
  decisionType: string,
): 'correct' | 'wrong' | 'misleading' | null {
  switch (decisionType) {
    case 'approve':
    case 'approved':
    case 'approve_with_edits':
      return 'correct';
    case 'reject':
    case 'rejected':
    case 'rolled_back':
      return 'wrong';
    case 'mark_as_misleading':
      return 'misleading';
    default:
      return null;
  }
}

/** taskType определяем из resourceType — мост между Curation и LLM router. */
function resourceTypeToTaskType(resourceType: string): string {
  switch (resourceType) {
    case 'decision':
      return 'decision-extract';
    case 'insight':
      return 'insight-cluster';
    case 'idea':
      return 'idea-extract';
    case 'regulation':
      return 'regulation-extract';
    case 'process':
      return 'process-extract';
    case 'policy':
      return 'policy-extract';
    case 'skill_trait':
      return 'skill-trait-detect';
    case 'card_rollup':
    case 'card':
      return 'card-rollup';
    default:
      return resourceType;
  }
}

const METRIC_SAMPLES_TOTAL = 'kc_preference_samples_total';

@Injectable()
export class PreferenceDatasetService {
  private readonly logger = new Logger(PreferenceDatasetService.name);
  private readonly samplesTotal: Counter<'task_type' | 'label'>;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.samplesTotal = this.getOrCreateCounter();
  }

  @OnEvent('curation.decision_recorded')
  async onDecisionRecorded(
    event: CurationDecisionRecordedEvent,
  ): Promise<void> {
    try {
      const label = decisionTypeToLabel(event.decisionType);
      if (!label) return; // escalate / merge_categories / unknown — пропускаем.

      if (!event.tenantId || !event.resourceType || !event.resourceId) {
        return;
      }
      const taskType = resourceTypeToTaskType(event.resourceType);
      const inputContext = (event.proposedPayload ?? {}) as Prisma.InputJsonValue;
      const modelOutput: Prisma.InputJsonValue = {
        decisionType: event.decisionType,
        resourceId: event.resourceId,
        reasoning: event.reasoning ?? null,
      };
      await this.prisma.llmPreferenceSample.create({
        data: {
          tenantId: event.tenantId,
          taskType,
          inputContext,
          modelOutput,
          label,
          reason: event.reasoning ?? null,
          recordedBy: event.reviewerUserId,
          decisionId: event.curationDecisionId ?? null,
        },
      });
      this.samplesTotal.inc({ task_type: taskType, label });
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          tenantId: event.tenantId,
          curationItemId: event.curationItemId,
        },
        'PreferenceDatasetService.onDecisionRecorded: не удалось записать sample (best-effort)',
      );
    }
  }

  /**
   * Экспорт сэмплов в формате JSONL (для retraining'а few-shot'ов).
   * Используется admin-endpoint'ом и offline-скриптами.
   */
  async exportJsonl(args: {
    taskType?: string;
    label?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<string> {
    const where: Prisma.LlmPreferenceSampleWhereInput = {};
    if (args.taskType) where.taskType = args.taskType;
    if (args.label) where.label = args.label;
    if (args.from || args.to) {
      where.createdAt = {};
      if (args.from) where.createdAt.gte = args.from;
      if (args.to) where.createdAt.lte = args.to;
    }
    const samples = await this.prisma.llmPreferenceSample.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 10_000,
    });
    return samples
      .map((s) =>
        JSON.stringify({
          id: s.id,
          tenantId: s.tenantId,
          taskType: s.taskType,
          inputContext: s.inputContext,
          modelOutput: s.modelOutput,
          label: s.label,
          reason: s.reason,
          recordedBy: s.recordedBy,
          decisionId: s.decisionId,
          createdAt: s.createdAt.toISOString(),
        }),
      )
      .join('\n');
  }

  private getOrCreateCounter(): Counter<'task_type' | 'label'> {
    const existing = register.getSingleMetric(METRIC_SAMPLES_TOTAL);
    if (existing instanceof Counter) {
      return existing as Counter<'task_type' | 'label'>;
    }
    return new Counter<'task_type' | 'label'>({
      name: METRIC_SAMPLES_TOTAL,
      help: 'W2.3: сколько LlmPreferenceSample записано (по task_type и label).',
      labelNames: ['task_type', 'label'],
    });
  }
}
