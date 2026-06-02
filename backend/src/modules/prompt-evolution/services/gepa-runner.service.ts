import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PromptFeedback } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

/**
 * Agents v2 Фаза C2 (2026-05-30) — GepaRunnerService.
 *
 * Вызывает GEPA optimization в ОТДЕЛЬНОМ контейнере `z-gepa` по HTTP. См.
 * `backend/python/gepa/server.py` (FastAPI), `backend/python/Dockerfile` и
 * `plans/tz/2026-05-29-agents-v2-umbrella.md` §C2.
 *
 * До 2026-06 Python запускался через `child_process.spawn` ВНУТРИ контейнера
 * backend — раздувало образ pip-зависимостями и плодило дочерние процессы в API.
 * Теперь GEPA крутится отдельным сервисом, backend ходит сюда по
 * `POST {GEPA_SERVICE_URL}/optimize`.
 *
 * Workflow:
 *   1. `runOptimization(promptKey, feedback, seedPrompt)` строит reflective
 *      dataset из feedback и POST'ит JSON-payload на gepa-сервис.
 *   2. Ждёт JSON-ответ (с hard-timeout cfg.gepa.timeoutMs через AbortController).
 *   3. Парсит ответ → `{ candidates: [{ text, metrics, traces }], costUsd? }`.
 *   4. Если сервис недоступен (connection refused / DNS) или timeout — лог warn
 *      + возвращает пустой массив (cron не падает).
 *
 * GepaRunner НЕ записывает candidates в БД — это делает caller (cron).
 * GepaRunner НЕ грузит prompt из БД — caller передаёт `seedPrompt` явно.
 *
 * Метрики:
 *   - `incGepaOptimization({promptKey, status: 'success'|'failed'|'timeout'|'skipped_no_python'})`
 *     ('skipped_no_python' = gepa-сервис недоступен; имя сохранено для
 *     совместимости с существующими дашбордами/метриками).
 *   - `incGepaCost({tenantTop, costUsd})` (если runner вернул cost_usd)
 */
@Injectable()
export class GepaRunnerService {
  private readonly logger = new Logger(GepaRunnerService.name);

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
      this.logger.warn(
        `GEPA: service call failed для promptKey=${promptKey}: ${msg}`,
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
   * HTTP-вызов gepa-сервиса (`POST {serviceUrl}/optimize`). Тело — тот же
   * JSON-payload, что раньше уходил в stdin subprocess'а; ответ — тот же JSON,
   * что раньше приходил из stdout.
   *
   * timeout: cfg.gepa.timeoutMs (default 1ч) через AbortController.
   * Различаем три класса ошибок по тексту message (caller матчит по подстроке):
   *   - 'timeout'      — превышен hard-timeout (AbortError).
   *   - 'unavailable'  — сервис не отвечает (connection refused / DNS / 5xx).
   *   - прочее         — невалидный ответ → caller пометит status='failed'.
   */
  private async callGepaService(
    payload: Record<string, unknown>,
  ): Promise<GepaRunnerOutput> {
    const url = `${this.cfg.gepa.serviceUrl.replace(/\/+$/, '')}/optimize`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.cfg.gepa.timeoutMs,
    );

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
      // fetch failed / ECONNREFUSED / ENOTFOUND — сервис недоступен.
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
