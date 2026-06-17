import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PromptFeedback } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

@Injectable()
export class GepaRunnerService {
  private readonly logger = new Logger(GepaRunnerService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async runOptimization(args: {
    promptKey: string;
    feedback: PromptFeedback[];
    seedPrompt: string;
    tenantTop?: string;
  }): Promise<{ candidates: PromptCandidateResult[]; costUsd: number | null }> {
    const { promptKey, feedback, seedPrompt } = args;

    if (feedback.length === 0) {
      this.logger.debug(`GEPA: empty feedback для promptKey=${promptKey}`);
      return { candidates: [], costUsd: null };
    }

    const reflectiveDataset = feedback
      .filter((f) => f.editedOutput != null && f.editedOutput.length > 0)
      .map((f) => ({
        input: f.inputDigest,
        original: f.originalOutput,
        edited: f.editedOutput ?? '',
        edit_distance: f.editDistance ?? null,
        downstream: f.downstreamSignals ?? null,
      }));

    if (reflectiveDataset.length === 0) {
      this.logger.debug(
        `GEPA: 0 edited feedback'ов для promptKey=${promptKey} (нечего эволюционировать)`,
      );
      this.metrics?.incGepaOptimization({ promptKey, status: 'failed' });
      return { candidates: [], costUsd: null };
    }

    const payload = {
      seed_prompt: seedPrompt,
      reflective_dataset: reflectiveDataset,
      task_lm: this.cfg.gepa.taskLm,
      reflection_lm: this.cfg.gepa.reflectionLm,
      max_metric_calls: this.cfg.gepa.maxMetricCalls,
    };

    let result: GepaRunnerOutput;
    try {
      result = await this.callGepaService(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unavailable')) {
        this.logger.warn(
          `GEPA: сервис ${this.cfg.gepa.serviceUrl} недоступен (${msg}) — пропускаю optimization для promptKey=${promptKey}`,
        );
        this.metrics?.incGepaOptimization({
          promptKey,
          status: 'skipped_no_python',
        });
        return { candidates: [], costUsd: null };
      }
      if (msg.includes('timeout')) {
        this.logger.warn(
          `GEPA: timeout (>${this.cfg.gepa.timeoutMs}ms) для promptKey=${promptKey}`,
        );
        this.metrics?.incGepaOptimization({ promptKey, status: 'timeout' });
        return { candidates: [], costUsd: null };
      }
      this.logger.warn(`GEPA: service call failed для promptKey=${promptKey}: ${msg}`);
      this.metrics?.incGepaOptimization({ promptKey, status: 'failed' });
      return { candidates: [], costUsd: null };
    }

    if (result.error) {
      this.logger.warn(`GEPA runner returned error для promptKey=${promptKey}: ${result.error}`);
      this.metrics?.incGepaOptimization({ promptKey, status: 'failed' });
      return { candidates: [], costUsd: null };
    }

    const candidates: PromptCandidateResult[] = (result.pareto_frontier ?? []).map((c) => ({
      text: typeof c.text === 'string' ? c.text : '',
      metrics:
        c.metrics && typeof c.metrics === 'object' ? (c.metrics as Record<string, number>) : {},
      traces: Array.isArray(c.traces) ? c.traces : [],
    }));

    const costUsd =
      typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd)
        ? result.cost_usd
        : null;

    this.metrics?.incGepaOptimization({ promptKey, status: 'success' });
    if (costUsd != null && args.tenantTop) {
      this.metrics?.incGepaCost({ tenantTop: args.tenantTop, costUsd });
    }

    this.logger.log(
      `GEPA: promptKey=${promptKey} optimization complete — ${candidates.length} candidates, cost=${costUsd ?? 'n/a'} USD`,
    );

    return { candidates, costUsd };
  }

  private async callGepaService(payload: Record<string, unknown>): Promise<GepaRunnerOutput> {
    const url = `${this.cfg.gepa.serviceUrl.replace(/\/+$/, '')}/optimize`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.gepa.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`GEPA service timeout`, { cause: err });
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`GEPA service unavailable: ${msg}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 500) {
      throw new Error(`GEPA service unavailable: HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`GEPA service HTTP ${res.status}`);
    }

    try {
      return (await res.json()) as GepaRunnerOutput;
    } catch (err) {
      throw new Error(
        `GEPA service вернул не-JSON: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

export interface PromptCandidateResult {
  text: string;
  metrics: Record<string, number>;
  traces: unknown[];
}

interface GepaRunnerOutput {
  pareto_frontier?: Array<{
    text?: string;
    metrics?: Record<string, number>;
    traces?: unknown[];
  }>;
  cost_usd?: number;
  error?: string;
  trace?: string;
}
