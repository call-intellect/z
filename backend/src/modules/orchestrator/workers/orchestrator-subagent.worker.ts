import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  OrchestratorAgentType,
  OrchestratorPlanStep,
} from '../orchestrator.types';
import {
  ORCHESTRATOR_SUBAGENTS_QUEUE,
  type OrchestratorSubagentJobData,
} from '../services/orchestrator-subagent.queue';
import { SubagentSpawnerService } from '../services/subagent-spawner.service';

/**
 * SBA δ-1 — `OrchestratorSubagentWorker`.
 *
 * Consumer очереди `orchestrator.subagents`. На каждый job:
 *   1) загружает OrchestratorSubagentJob из БД;
 *   2) переводит status='running' + startedAt;
 *   3) вызывает соответствующую стратегию через SubagentSpawnerService.executeStrategyDirectly;
 *   4) сохраняет resultJson + status='done'/'failed' + completedAt;
 *   5) инкрементит метрику orchestrator_subagents_total{agent_type,result}.
 *
 * Concurrency=3 — параллельные subagent'ы одного run'а должны вращаться
 * одновременно (5 max per run × несколько runs).
 */
@Injectable()
export class OrchestratorSubagentWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrchestratorSubagentWorker.name);
  private worker: Worker<OrchestratorSubagentJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(SubagentSpawnerService)
    private readonly spawner: SubagentSpawnerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<OrchestratorSubagentJobData>(
      ORCHESTRATOR_SUBAGENTS_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 3,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `subagent job failed jobId=${job?.id ?? 'unknown'}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.logger.log(
      `OrchestratorSubagentWorker запущен (${ORCHESTRATOR_SUBAGENTS_QUEUE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<OrchestratorSubagentJobData>): Promise<void> {
    const { subagentJobId, tenantId, userId, timeoutMsPerStep } = job.data;

    const subagent = await this.prisma.orchestratorSubagentJob.findUnique({
      where: { id: subagentJobId },
    });
    if (!subagent) {
      this.logger.warn(
        { subagentJobId },
        'subagent job не найден в БД — skip',
      );
      return;
    }
    if (subagent.status === 'done' || subagent.status === 'failed') {
      this.logger.debug(
        { subagentJobId, status: subagent.status },
        'subagent уже терминальный — skip',
      );
      return;
    }

    await this.prisma.orchestratorSubagentJob.update({
      where: { id: subagentJobId },
      data: { status: 'running', startedAt: new Date() },
    });

    const step = subagent.contextJson as unknown as OrchestratorPlanStep;
    const agentType = subagent.agentType as OrchestratorAgentType;

    try {
      const result = await this.spawner.executeStrategyDirectly({
        step,
        tenantId,
        userId,
        timeoutMs: timeoutMsPerStep,
      });
      await this.prisma.orchestratorSubagentJob.update({
        where: { id: subagentJobId },
        data: {
          status: 'done',
          completedAt: new Date(),
          resultJson: result as unknown as Prisma.InputJsonValue,
        },
      });
      this.metrics.incOrchestratorSubagent({
        agentType,
        result: 'done',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { subagentJobId, err: msg },
        'subagent execution failed',
      );
      await this.prisma.orchestratorSubagentJob.update({
        where: { id: subagentJobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: msg.slice(0, 1000),
        },
      });
      this.metrics.incOrchestratorSubagent({
        agentType,
        result: 'failed',
      });
      throw err; // BullMQ retry
    }
  }
}
