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

      // G7 дедуп: событие `curation.decision_recorded` может прийти повторно
      // (ретрай эмиттера/воркера) → без guard'а получим дубль-sample. У модели
      // LlmPreferenceSample нет @unique, поэтому findFirst перед create.
      //   - есть curationDecisionId → один sample на curation-решение
      //     (decisionId — естественный ключ-источник);
      //   - нет id решения → fallback по (tenantId, taskType, resourceId, label).
      const dedupWhere: Prisma.LlmPreferenceSampleWhereInput =
        event.curationDecisionId
          ? { tenantId: event.tenantId, decisionId: event.curationDecisionId }
          : {
              tenantId: event.tenantId,
              taskType,
              label,
              modelOutput: {
                path: ['resourceId'],
                equals: event.resourceId,
              },
            };
      const existing = await this.prisma.llmPreferenceSample.findFirst({
        where: dedupWhere,
        select: { id: true },
      });
      if (existing) {
        // Повтор события — sample уже записан, no-op.
        return;
      }

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
    const items = await this.listItems({ ...args, limit: args.limit ?? 10_000 });
    return items.map((s) => JSON.stringify(s)).join('\n');
  }

  /**
   * Структурированный список сэмплов (для admin-UI `/admin/ai/preference-dataset`).
   * В отличие от exportJsonl возвращает массив, а не строку — UI рендерит таблицу
   * + позволяет фильтровать. Дефолтный лимит ниже (200), потому что UI не должен
   * грузить десятки тысяч записей.
   */
  async listItems(args: {
    taskType?: string;
    label?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      tenantId: string;
      taskType: string;
      inputContext: unknown;
      modelOutput: unknown;
      label: string;
      reason: string | null;
      recordedBy: string | null;
      decisionId: string | null;
      createdAt: string;
    }>
  > {
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
      take: Math.max(1, Math.min(50_000, args.limit ?? 200)),
    });
    return samples.map((s) => ({
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
    }));
  }

  /**
   * Сводка для дашборда `/admin/ai/preference-dataset` — счётчики по
   * `(taskType, label)` за период, плюс глобальный total. Хорошая «первая
   * картинка» при открытии страницы.
   */
  async stats(args: { from?: Date; to?: Date }): Promise<{
    total: number;
    byLabel: Record<string, number>;
    byTaskType: Array<{
      taskType: string;
      correct: number;
      wrong: number;
      misleading: number;
      total: number;
    }>;
  }> {
    const where: Prisma.LlmPreferenceSampleWhereInput = {};
    if (args.from || args.to) {
      where.createdAt = {};
      if (args.from) where.createdAt.gte = args.from;
      if (args.to) where.createdAt.lte = args.to;
    }
    const grouped = await this.prisma.llmPreferenceSample.groupBy({
      by: ['taskType', 'label'],
      where,
      _count: { _all: true },
    });
    const byLabel: Record<string, number> = {};
    const byTaskMap = new Map<
      string,
      { correct: number; wrong: number; misleading: number; total: number }
    >();
    let total = 0;
    for (const row of grouped) {
      const n = row._count._all;
      total += n;
      byLabel[row.label] = (byLabel[row.label] ?? 0) + n;
      const cur = byTaskMap.get(row.taskType) ?? {
        correct: 0,
        wrong: 0,
        misleading: 0,
        total: 0,
      };
      cur.total += n;
      if (row.label === 'correct') cur.correct += n;
      else if (row.label === 'wrong') cur.wrong += n;
      else if (row.label === 'misleading') cur.misleading += n;
      byTaskMap.set(row.taskType, cur);
    }
    const byTaskType = Array.from(byTaskMap.entries())
      .map(([taskType, v]) => ({ taskType, ...v }))
      .sort((a, b) => b.total - a.total);
    return { total, byLabel, byTaskType };
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
