import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Counter, Histogram, register } from 'prom-client';

/**
 * Кастомные бизнес-метрики Z. Регистрируются в дефолтном `prom-client`
 * registry, который `@willsoto/nestjs-prometheus` отдаёт на `/metrics`.
 *
 * Имена и лейблы согласованы с
 * `plans/architecture/2026-05-08-z-architecture.md` §6.6 и
 * `plans/tz/2026-05-08-mvp-fullstack-tz.md` §1.4.
 */
@Injectable()
export class BusinessMetricsService implements OnModuleInit {
  // ── meetings ────────────────────────────────────────────────────────
  private meetingsCreatedTotal!: Counter<'type'>;
  private meetingsFinishedTotal!: Counter<'type'>;
  private meetingsFailedTotal!: Counter<'stage'>;

  // ── ai pipeline ─────────────────────────────────────────────────────
  private aiPipelineDurationSeconds!: Histogram<'stage' | 'type' | 'model'>;
  private aiCostUsdTotal!: Counter<string>;

  // ── recordings / storage ────────────────────────────────────────────
  private recordingsBytesTotal!: Counter<string>;
  private recordingsDeletedTotal!: Counter<'reason'>;
  private recordingsFailedTotal!: Counter<'reason'>;

  // ── integrations ────────────────────────────────────────────────────
  private crossmarkApiRequestsTotal!: Counter<'endpoint' | 'status'>;
  private livekitWebhookEventsTotal!: Counter<'type'>;

  // ── llm fallback ────────────────────────────────────────────────────
  private llmFallbackTotal!: Counter<'provider'>;

  onModuleInit(): void {
    this.meetingsCreatedTotal = this.getOrCreateCounter({
      name: 'meetings_created_total',
      help: 'Сколько встреч было создано (по типу).',
      labelNames: ['type'] as const,
    });

    this.meetingsFinishedTotal = this.getOrCreateCounter({
      name: 'meetings_finished_total',
      help: 'Сколько встреч завершилось штатно (по типу).',
      labelNames: ['type'] as const,
    });

    this.meetingsFailedTotal = this.getOrCreateCounter({
      name: 'meetings_failed_total',
      help: 'Сколько встреч завершилось с ошибкой (на какой стадии).',
      labelNames: ['stage'] as const,
    });

    this.aiPipelineDurationSeconds = this.getOrCreateHistogram({
      name: 'ai_pipeline_duration_seconds',
      help: 'Длительность стадий AI-пайплайна (ASR, диаризация, LLM).',
      labelNames: ['stage', 'type', 'model'] as const,
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800],
    });

    this.aiCostUsdTotal = this.getOrCreateCounter({
      name: 'ai_cost_usd_total',
      help: 'Суммарная стоимость AI-вызовов в USD.',
    });

    this.recordingsBytesTotal = this.getOrCreateCounter({
      name: 'recordings_bytes_total',
      help: 'Суммарный объём записей, сохранённых в S3 (байт).',
    });

    this.recordingsDeletedTotal = this.getOrCreateCounter({
      name: 'recordings_deleted_total',
      help: 'Сколько записей было удалено и по какой причине.',
      labelNames: ['reason'] as const,
    });

    this.recordingsFailedTotal = this.getOrCreateCounter({
      name: 'recordings_failed_total',
      help: 'Сколько Egress-задач упало (по причине: timeout/s3-error/livekit-error/...).',
      labelNames: ['reason'] as const,
    });

    this.llmFallbackTotal = this.getOrCreateCounter({
      name: 'llm_fallback_total',
      help: 'Срабатывания LLM-fallback по провайдерам (anthropic→minimax→openai-via-proxy).',
      labelNames: ['provider'] as const,
    });

    this.crossmarkApiRequestsTotal = this.getOrCreateCounter({
      name: 'crossmark_api_requests_total',
      help: 'Запросы к интеграционному API Crossmark.',
      labelNames: ['endpoint', 'status'] as const,
    });

    this.livekitWebhookEventsTotal = this.getOrCreateCounter({
      name: 'livekit_webhook_events_total',
      help: 'События LiveKit webhook (по типу).',
      labelNames: ['type'] as const,
    });
  }

  // ────────────────────── обёртки-методы ───────────────────────────────

  incMeetingCreated(type: string): void {
    this.meetingsCreatedTotal.inc({ type });
  }

  incMeetingFinished(type: string): void {
    this.meetingsFinishedTotal.inc({ type });
  }

  incMeetingFailed(stage: string): void {
    this.meetingsFailedTotal.inc({ stage });
  }

  observeAiPipelineDuration(args: {
    stage: string;
    type: string;
    model: string;
    seconds: number;
  }): void {
    this.aiPipelineDurationSeconds.observe(
      { stage: args.stage, type: args.type, model: args.model },
      args.seconds,
    );
  }

  addAiCostUsd(amount: number): void {
    this.aiCostUsdTotal.inc(amount);
  }

  addRecordingBytes(bytes: number): void {
    this.recordingsBytesTotal.inc(bytes);
  }

  /** Алиас под более «глагольное» имя, фигурирует в ТЗ Фазы 4. */
  incRecordingsBytes(bytes: number): void {
    this.recordingsBytesTotal.inc(bytes);
  }

  incRecordingDeleted(reason: string): void {
    this.recordingsDeletedTotal.inc({ reason });
  }

  /** Алиас. ТЗ Фазы 4 называет метод `incRecordingsDeleted({reason})`. */
  incRecordingsDeleted(args: { reason: string }): void {
    this.recordingsDeletedTotal.inc({ reason: args.reason });
  }

  incRecordingFailed(reason: string): void {
    this.recordingsFailedTotal.inc({ reason });
  }

  /** Алиас под имя из ТЗ Фазы 4 (`incRecordingsFailed({reason})`). */
  incRecordingsFailed(args: { reason: string }): void {
    this.recordingsFailedTotal.inc({ reason: args.reason });
  }

  /**
   * Срабатывание LLM-fallback. `provider` — провайдер, на КОТОРЫЙ упали
   * (например: `provider='minimax'` означает «Anthropic не сработал, перешли на MiniMax»).
   */
  incLlmFallback(provider: string): void {
    this.llmFallbackTotal.inc({ provider });
  }

  incCrossmarkApiRequest(endpoint: string, status: number | string): void {
    this.crossmarkApiRequestsTotal.inc({
      endpoint,
      status: String(status),
    });
  }

  incLivekitWebhookEvent(type: string): void {
    this.livekitWebhookEventsTotal.inc({ type });
  }

  // ────────────────────── helpers ──────────────────────────────────────

  /**
   * Идемпотентная регистрация: если метрика уже зарегистрирована
   * в дефолтном registry (например, при hot-reload в dev-режиме) —
   * переиспользуем её.
   */
  private getOrCreateCounter<L extends string>(config: {
    name: string;
    help: string;
    labelNames?: readonly L[];
  }): Counter<L> {
    const existing = register.getSingleMetric(config.name);
    if (existing instanceof Counter) {
      return existing as Counter<L>;
    }
    return new Counter<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames as L[] | undefined) ?? [],
    });
  }

  private getOrCreateHistogram<L extends string>(config: {
    name: string;
    help: string;
    labelNames?: readonly L[];
    buckets?: number[];
  }): Histogram<L> {
    const existing = register.getSingleMetric(config.name);
    if (existing instanceof Histogram) {
      return existing as Histogram<L>;
    }
    return new Histogram<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames as L[] | undefined) ?? [],
      buckets: config.buckets,
    });
  }
}
