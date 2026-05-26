import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  OrchestratorAgentType,
  OrchestratorPlanStep,
  OrchestratorSubagentResult,
} from '../orchestrator.types';
import { ComparisonStrategy } from '../strategies/comparison.strategy';
import { EntityResearchStrategy } from '../strategies/entity-research.strategy';
import type { SubagentStrategy } from '../strategies/subagent-strategy';
import { TimelineConstructionStrategy } from '../strategies/timeline-construction.strategy';
import { TopicSummaryStrategy } from '../strategies/topic-summary.strategy';

import { OrchestratorSubagentQueue } from './orchestrator-subagent.queue';

export interface SpawnInput {
  runId: string;
  tenantId: string;
  userId: string;
  steps: OrchestratorPlanStep[];
  /** Жёсткий timeout (ms) на ОДИН subagent. */
  timeoutMsPerStep: number;
}

export interface SpawnedSubagent {
  stepIndex: number;
  agentType: OrchestratorAgentType;
  jobId: string;
  description: string;
}

/**
 * SBA δ-1 — SubagentSpawnerService.
 *
 * Запускает subagent'ы параллельно через BullMQ-очередь `orchestrator.subagents`.
 * Создаёт `OrchestratorSubagentJob` строки в БД (status='pending'), enqueue'ит
 * job'ы, и оставляет worker'у задачу маркировать done/failed.
 *
 * Это thin coordinator — реальная работа делается в worker'е (`OrchestratorSubagentWorker`),
 * которая зовёт стратегии через `executeStrategyDirectly()` (для unit-тестов
 * также можно).
 */
@Injectable()
export class SubagentSpawnerService {
  private readonly logger = new Logger(SubagentSpawnerService.name);
  private readonly strategyMap: Map<OrchestratorAgentType, SubagentStrategy>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(OrchestratorSubagentQueue)
    private readonly queue: OrchestratorSubagentQueue,
    @Inject(EntityResearchStrategy)
    entityResearch: EntityResearchStrategy,
    @Inject(ComparisonStrategy) comparison: ComparisonStrategy,
    @Inject(TopicSummaryStrategy) topicSummary: TopicSummaryStrategy,
    @Inject(TimelineConstructionStrategy)
    timeline: TimelineConstructionStrategy,
  ) {
    this.strategyMap = new Map<OrchestratorAgentType, SubagentStrategy>([
      ['entity_research', entityResearch],
      ['comparison', comparison],
      ['topic_summary', topicSummary],
      ['timeline_construction', timeline],
    ]);
  }

  /**
   * Создать DB-jobs + enqueue в BullMQ. Возвращает список jobId'ов.
   * НЕ ждёт завершения — caller (OrchestratorService) поллит DB
   * с интервалом / await'ит.
   */
  async spawn(input: SpawnInput): Promise<SpawnedSubagent[]> {
    const created: SpawnedSubagent[] = [];

    for (const step of input.steps) {
      const job = await this.prisma.orchestratorSubagentJob.create({
        data: {
          runId: input.runId,
          stepIndex: step.stepIndex,
          agentType: step.agentType,
          contextJson: step as unknown as Prisma.InputJsonValue,
          status: 'pending',
        },
        select: { id: true },
      });

      try {
        await this.queue.enqueue({
          subagentJobId: job.id,
          runId: input.runId,
          tenantId: input.tenantId,
          userId: input.userId,
          timeoutMsPerStep: input.timeoutMsPerStep,
        });
        created.push({
          stepIndex: step.stepIndex,
          agentType: step.agentType,
          jobId: job.id,
          description: step.description,
        });
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'enqueue subagent failed — mark job failed in DB',
        );
        await this.prisma.orchestratorSubagentJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            errorMessage: 'enqueue failed',
            completedAt: new Date(),
          },
        });
        this.metrics.incOrchestratorSubagent({
          agentType: step.agentType,
          result: 'failed',
        });
      }
    }

    return created;
  }

  /**
   * Прямой вызов стратегии (используется в worker'е и в unit-тестах).
   * Возвращает результат subagent'а; не пишет в БД.
   */
  async executeStrategyDirectly(args: {
    step: OrchestratorPlanStep;
    tenantId: string;
    userId: string;
    timeoutMs: number;
  }): Promise<OrchestratorSubagentResult> {
    const strategy = this.strategyMap.get(args.step.agentType);
    if (!strategy) {
      return {
        text: `Стратегия ${args.step.agentType} не реализована.`,
        citations: [],
        confidence: 0,
      };
    }
    return strategy.execute({
      step: args.step,
      tenantId: args.tenantId,
      userId: args.userId,
      timeoutMs: args.timeoutMs,
    });
  }
}
