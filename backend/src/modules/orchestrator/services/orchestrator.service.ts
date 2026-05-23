import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

/**
 * SBA δ-1 — OrchestratorService.
 *
 * Главный фасад. 4 шага:
 *   planning → subagents_running → synthesizing → verifying → done|failed.
 *
 * `run({task, tenantId, userId, depth=1}) → AsyncIterable<Event>`.
 *
 * Hard limits (anti-cost-runaway):
 *   - depth=1 (clamp принудительно);
 *   - max `maxSubagentsPerRun` subagents;
 *   - 15-min run timeout;
 *   - feature-flag `ORCHESTRATOR_ENABLED=false` default → возвращает error event.
 *
 * Subagent context isolation — каждый subagent получает только свой
 * `OrchestratorPlanStep.contextSlice`, НЕ полную историю.
 *
 * Verification retry: если verification.confidence < 0.6 — один retry
 * (повторный synthesis по тем же subagent-результатам + re-verify).
 */
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
  ) {}

  async *run(
    input: OrchestratorRunInput,
  ): AsyncIterable<OrchestratorStreamEvent> {
    const limits = readOrchestratorLimits();
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
    // Per-subagent timeout — половина run timeout (anti-runaway).
    const timeoutMsPerStep = Math.max(60_000, Math.floor(timeoutMs / 2));

    // 1) создаём run.
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
      // 2) planning.
      const plan = await this.planning.plan({
        task: input.task,
        tenantId: input.tenantId,
        userId: input.userId,
      });
      // hard-clamp steps to maxSubagentsPerRun.
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

      // 3) spawn subagents.
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

      // 4) poll subagent statuses до завершения (или timeout).
      const results = await this.waitForSubagents({
        runId: run.id,
        expectedCount: spawned.length,
        deadlineMs,
      });

      // emit per-subagent events для всех.
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

      // Если ВСЕ упали — это failed run.
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

      // 5) synthesizing.
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

      // 6) verifying (+ retry max 1).
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

      // 7) done.
      await this.prisma.orchestratorRun.update({
        where: { id: run.id },
        data: { status: 'done', completedAt: new Date() },
      });
      yield { type: 'done', runId: run.id };
    } catch (err) {
      finalStatus = err instanceof TimeoutError ? 'timeout' : 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { runId: run.id, err: msg },
        'orchestrator run failed',
      );
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

  /**
   * Polling: ждём, пока все subagent-jobs run'а перейдут в done/failed,
   * либо наступит deadline.
   */
  private async waitForSubagents(args: {
    runId: string;
    expectedCount: number;
    deadlineMs: number;
  }): Promise<
    Array<{ stepIndex: number; ok: boolean; result: OrchestratorSubagentResult }>
  > {
    while (Date.now() < args.deadlineMs) {
      const jobs = await this.prisma.orchestratorSubagentJob.findMany({
        where: { runId: args.runId },
        orderBy: { stepIndex: 'asc' },
      });
      const terminal = jobs.every(
        (j) => j.status === 'done' || j.status === 'failed',
      );
      if (terminal || jobs.length === 0) {
        return jobs.map((j) => ({
          stepIndex: j.stepIndex,
          ok: j.status === 'done',
          result:
            (j.resultJson as unknown as OrchestratorSubagentResult | null) ?? {
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
    // timeout — пометим pending/running как failed и вернём.
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
