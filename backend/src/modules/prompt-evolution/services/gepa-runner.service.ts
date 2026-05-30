import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PromptFeedback } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

/**
 * Agents v2 Фаза C2 (2026-05-30) — GepaRunnerService.
 *
 * Запускает GEPA optimization через Python subprocess. См.
 * `backend/python/gepa/runner.py` и
 * `plans/tz/2026-05-29-agents-v2-umbrella.md` §C2.
 *
 * Workflow:
 *   1. `runOptimization(promptKey, feedback, seedPrompt)` строит reflective
 *      dataset из feedback, spawn'ит python3 runner.py с JSON-payload.
 *   2. Ждёт результат stdout (с hard-timeout cfg.gepa.timeoutMs).
 *   3. Парсит ответ → `{ candidates: [{ text, metrics, traces }], costUsd? }`.
 *   4. Если subprocess недоступен (ENOENT при spawn'е) или timeout — лог warn
 *      + возвращает пустой массив (cron не падает).
 *
 * GepaRunner НЕ записывает candidates в БД — это делает caller (cron).
 * GepaRunner НЕ грузит prompt из БД — caller передаёт `seedPrompt` явно.
 *
 * Метрики:
 *   - `incGepaOptimization({promptKey, status: 'success'|'failed'|'timeout'|'skipped_no_python'})`
 *   - `incGepaCost({tenantTop, costUsd})` (если runner вернул cost_usd)
 */
@Injectable()
export class GepaRunnerService {
  private readonly logger = new Logger(GepaRunnerService.name);

  /**
   * Кэш проверки доступности Python. Делаем lazy один раз на процесс,
   * чтобы не блокировать startup.
   */
  private pythonAvailable: boolean | null = null;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Главный entry-point. Caller (gepa-optimize cron) передаёт:
   *   - `promptKey` — для логирования + метрики.
   *   - `feedback` — массив PromptFeedback (последние 30 дней).
   *   - `seedPrompt` — текущий system prompt из LlmTaskRoute.promptOverride
   *     либо code-fallback prompt.
   *   - `tenantTop` (опц.) — bucket для cost-метрики.
   *
   * Если Python недоступен / subprocess упал — `candidates: []` + лог warn.
   * Cron не должен падать из-за отсутствия Python в окружении.
   */
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
        input: f.inputDigest, // первичный ключ группировки; полный input
        // не пробрасываем (PII, размер) — GEPA эволюционирует prompt по diff.
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

    const scriptPath = join(
      process.cwd(),
      'backend',
      'python',
      'gepa',
      'runner.py',
    );
    // Fallback на относительный путь от backend/ (в Docker WORKDIR=/app).
    const altScriptPath = join(process.cwd(), 'python', 'gepa', 'runner.py');

    let result: GepaRunnerOutput;
    try {
      result = await this.spawnRunner(scriptPath, altScriptPath, payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('no_python')) {
        this.logger.warn(
          `GEPA: python3 недоступен (${msg}) — пропускаю optimization для promptKey=${promptKey}`,
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
      this.logger.warn(
        `GEPA: subprocess failed для promptKey=${promptKey}: ${msg}`,
      );
      this.metrics?.incGepaOptimization({ promptKey, status: 'failed' });
      return { candidates: [], costUsd: null };
    }

    if (result.error) {
      this.logger.warn(
        `GEPA runner returned error для promptKey=${promptKey}: ${result.error}`,
      );
      this.metrics?.incGepaOptimization({ promptKey, status: 'failed' });
      return { candidates: [], costUsd: null };
    }

    const candidates: PromptCandidateResult[] = (
      result.pareto_frontier ?? []
    ).map((c) => ({
      text: typeof c.text === 'string' ? c.text : '',
      metrics:
        c.metrics && typeof c.metrics === 'object'
          ? (c.metrics as Record<string, number>)
          : {},
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

  /**
   * Низкоуровневая обёртка вокруг child_process.spawn. Пробуем основной путь
   * (backend/python/gepa/runner.py от cwd проекта), при ENOENT — fallback на
   * python/gepa/runner.py (Docker WORKDIR=/app).
   *
   * timeout: cfg.gepa.timeoutMs (default 1ч). На timeout — kill subprocess.
   */
  private async spawnRunner(
    primaryScript: string,
    altScript: string,
    payload: Record<string, unknown>,
  ): Promise<GepaRunnerOutput> {
    const tryRun = (script: string): Promise<GepaRunnerOutput> =>
      new Promise((resolve, reject) => {
        const child = spawn(this.cfg.gepa.pythonPath, [script], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          reject(new Error(`GEPA subprocess timeout`));
        }, this.cfg.gepa.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', (err: NodeJS.ErrnoException) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code !== 0 && stdout.trim().length === 0) {
            reject(
              new Error(
                `GEPA subprocess exit ${code}: ${stderr.slice(0, 500) || 'no stderr'}`,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(stdout.trim()) as GepaRunnerOutput;
            resolve(parsed);
          } catch (err) {
            reject(
              new Error(
                `GEPA subprocess вернул не-JSON: ${err instanceof Error ? err.message : String(err)} (stdout=${stdout.slice(0, 200)})`,
              ),
            );
          }
        });

        try {
          child.stdin.write(JSON.stringify(payload));
          child.stdin.end();
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

    try {
      return await tryRun(primaryScript);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ENOENT на самом скрипте — пробуем альтернативный путь.
      if (msg.includes('ENOENT')) {
        return await tryRun(altScript);
      }
      throw err;
    }
  }
}

// ─────────────────────────── Types ──────────────────────────────────────────

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
