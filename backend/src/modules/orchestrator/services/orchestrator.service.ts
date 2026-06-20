import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { readOrchestratorLimits } from '../orchestrator.config';
import type {
  OrchestratorRunInput,
  OrchestratorStreamEvent,
  OrchestratorSubagentResult,
  OrchestratorSynthesis,
  OrchestratorVerification,
} from '../orchestrator.types';

import { PlanningService } from './planning.service';
import { SubagentSpawnerService } from './subagent-spawner.service';
import { SynthesisService } from './synthesis.service';
import { VerificationService } from './verification.service';

const POLL_INTERVAL_MS = 1500;
const VERIFICATION_RETRY_THRESHOLD = 0.6;
const MAX_VERIFICATION_RETRIES = 1;

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlanningService) private readonly planning: PlanningService,
    @Inject(SubagentSpawnerService)
    private readonly spawner: SubagentSpawnerService,
    @Inject(SynthesisService) private readonly synthesis: SynthesisService,
    @Inject(VerificationService)
    private readonly verification: VerificationService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async *run(input: OrchestratorRunInput): AsyncIterable<OrchestratorStreamEvent> {
    const limits = readOrchestratorLimits(this.cfg);
    if (!limits.enabled) {
      yield {
        type: 'error',
        code: 'orchestrator_disabled',
        message: 'Orchestrator выключен (ORCHESTRATOR_ENABLED=false).',
      };
      return;
    }

    const startMs = Date.now();
    const timeoutMs = limits.runTimeoutMinutes * 60_000;
    const deadlineMs = startMs + timeoutMs;
    const timeoutMsPerStep = Math.max(60_000, Math.floor(timeoutMs / 2));

    const run = await this.prisma.orchestratorRun.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        task: input.task.slice(0, 8000),
        status: 'planning',
      },
      select: { id: true },
    });
    yield { type: 'started', runId: run.id };

    let finalStatus: 'done' | 'failed' | 'timeout' | 'cancelled' = 'done';
    try {
      const plan = await this.planning.plan({
        task: input.task,
        tenantId: input.tenantId,
        userId: input.userId,
      });
      const cappedSteps = plan.steps
        .slice(0, limits.maxSubagentsPerRun)
        .map((s, i) => ({ ...s, stepIndex: i }));
      const cappedPlan = { ...plan, steps: cappedSteps };
      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: {
          status: 'subagents_running',
          planJson: cappedPlan as unknown as Prisma.InputJsonValue,
        },
      });
      yield { type: 'plan', plan: cappedPlan };

      const spawned = await this.spawner.spawn({
        runId: run.id,
        tenantId: input.tenantId,
        userId: input.userId,
        steps: cappedSteps,
        timeoutMsPerStep,
      });
      for (const s of spawned) {
        yield {
          type: 'subagent_started',
          stepIndex: s.stepIndex,
          agentType: s.agentType,
          description: s.description,
        };
      }

      const results = await this.waitForSubagents({
        runId: run.id,
        expectedCount: spawned.length,
        deadlineMs,
      });

      for (const r of results) {
        const step = cappedSteps.find((s) => s.stepIndex === r.stepIndex);
        if (!step) continue;
        yield {
          type: 'subagent_completed',
          stepIndex: r.stepIndex,
          agentType: step.agentType,
          ok: r.ok,
          preview: r.result.text.slice(0, 280),
        };
      }

      const successResults = results.filter((r) => r.ok);
      if (successResults.length === 0) {
        finalStatus = 'failed';
        await this.prisma.orchestratorRun.update({
          where: { id: run.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: 'все subagent-ы упали',
          },
        });
        yield {
          type: 'error',
          code: 'all_subagents_failed',
          message: 'Все subagent-ы упали — не из чего синтезировать ответ.',
        };
        return;
      }

      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: { status: 'synthesizing' },
      });
      const synthInput = successResults
        .map((r) => ({
          step: cappedSteps.find((s) => s.stepIndex === r.stepIndex)!,
          result: r.result,
        }))
        .filter((x) => !!x.step);
      let synthesis: OrchestratorSynthesis = await this.synthesis.synthesize({
        task: input.task,
        tenantId: input.tenantId,
        userId: input.userId,
        results: synthInput,
      });
      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: {
          synthesisJson: synthesis as unknown as Prisma.InputJsonValue,
        },
      });
      yield { type: 'synthesis', synthesis };

      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: { status: 'verifying' },
      });
      let verification: OrchestratorVerification = await this.verification.verify({
        task: input.task,
        synthesis,
        tenantId: input.tenantId,
        userId: input.userId,
        retried: false,
      });

      let retriesUsed = 0;
      while (
        verification.confidence < VERIFICATION_RETRY_THRESHOLD &&
        retriesUsed < MAX_VERIFICATION_RETRIES
      ) {
        retriesUsed++;
        this.logger.log(
          { runId: run.id, confidence: verification.confidence },
          'verification confidence < threshold → retry synthesis',
        );
        synthesis = await this.synthesis.synthesize({
          task: input.task,
          tenantId: input.tenantId,
          userId: input.userId,
          results: synthInput,
        });
        await this.prisma.orchestratorRun.update({
          where: { id: run.id },
          data: {
            synthesisJson: synthesis as unknown as Prisma.InputJsonValue,
          },
        });
        yield { type: 'synthesis', synthesis };
        verification = await this.verification.verify({
          task: input.task,
          synthesis,
          tenantId: input.tenantId,
          userId: input.userId,
          retried: true,
        });
      }
      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: {
          verificationJson: verification as unknown as Prisma.InputJsonValue,
        },
      });
      yield { type: 'verification', verification };

      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: { status: 'done', completedAt: new Date() },
      });
      yield { type: 'done', runId: run.id };
    } catch (err) {
      finalStatus = err instanceof TimeoutError ? 'timeout' : 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ runId: run.id, err: msg }, 'orchestrator run failed');
      try {
        await this.prisma.orchestratorRun.update({
          where: { id: run.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: msg.slice(0, 1000),
          },
        });
      } catch (e) {
        this.logger.warn(
          `update failed status failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      yield {
        type: 'error',
        code: finalStatus === 'timeout' ? 'timeout' : 'run_failed',
        message: msg,
      };
    } finally {
      const durationSec = (Date.now() - startMs) / 1000;
      this.metrics.observeOrchestratorRunDurationSeconds(durationSec);
      this.metrics.incOrchestratorRun({ status: finalStatus });
    }
  }

  private async waitForSubagents(args: {
    runId: string;
    expectedCount: number;
    deadlineMs: number;
  }): Promise<Array<{ stepIndex: number; ok: boolean; result: OrchestratorSubagentResult }>> {
    while (Date.now() < args.deadlineMs) {
      const jobs = await this.prisma.orchestratorSubagentJob.findMany({
        where: { runId: args.runId },
        orderBy: { stepIndex: 'asc' },
      });
      const terminal = jobs.every((j) => j.status === 'done' || j.status === 'failed');
      if (terminal || jobs.length === 0) {
        return jobs.map((j) => ({
          stepIndex: j.stepIndex,
          ok: j.status === 'done',
          result: (j.resultJson as unknown as OrchestratorSubagentResult | null) ?? {
            text:
              j.status === 'failed'
                ? `(subagent упал: ${j.errorMessage ?? 'unknown error'})`
                : '(нет результата)',
            citations: [],
            confidence: 0,
          },
        }));
      }
      await sleep(POLL_INTERVAL_MS);
    }
    await this.prisma.orchestratorSubagentJob.updateMany({
      where: {
        runId: args.runId,
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: 'run timeout',
      },
    });
    const finalJobs = await this.prisma.orchestratorSubagentJob.findMany({
      where: { runId: args.runId },
      orderBy: { stepIndex: 'asc' },
    });
    throw new TimeoutError(
      `Orchestrator run ${args.runId} timeout (${finalJobs.length} subagents, ${args.expectedCount} expected)`,
    );
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorTimeoutError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
