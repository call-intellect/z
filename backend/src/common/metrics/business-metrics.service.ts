import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, register } from 'prom-client';

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

  // ── llm router (per-task routing) ───────────────────────────────────
  private llmRouterDispatchTotal!: Counter<'task_type' | 'provider' | 'status'>;

  // ── llm router fallback exhausted (Фаза A.4) ────────────────────────
  private coreLlmNoProviderTotal!: Counter<'task_type'>;

  // ── admin ai-models (Фаза A.4) ──────────────────────────────────────
  private adminAiModelsRouteChangeTotal!: Counter<'task_type' | 'change_type'>;
  private adminAiModelsExperimentStartedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentStoppedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentCompletedTotal!: Counter<'task_type'>;

  // ── prompt resolver (Фаза A.1) ──────────────────────────────────────
  private promptResolverTotal!: Counter<'source'>;
  private promptResolverFallbackTotal!: Counter<'reason'>;

  // ── prompt templates admin (Фаза A.2) ───────────────────────────────
  private promptTemplateActiveCount!: Gauge<'scope'>;
  private promptTemplatePreviewTotal!: Counter<'result'>;

  // ── prompt experiments + feedback (Фаза A.3) ────────────────────────
  private promptExperimentActiveCount!: Gauge<string>;
  private promptExperimentCompletedTotal!: Counter<'reason'>;
  private promptTemplateFeedbackTotal!: Counter<'reaction'>;

  // ── embeddings ──────────────────────────────────────────────────────
  private embeddingTokensTotal!: Counter<'provider' | 'status'>;
  private embeddingChunksTotal!: Counter<'status'>;

  // ── clip render ─────────────────────────────────────────────────────
  private mp4RenderDurationSeconds!: Histogram<'status'>;

  // ── ai-workspace cross-cutting ──────────────────────────────────────
  private webhookDeliveryTotal!: Counter<'event' | 'status'>;
  private quotaExceededTotal!: Counter<'quota_name'>;
  private exportCompletedTotal!: Counter<'type' | 'status'>;
  private chatRequestTotal!: Counter<'scope'>;

  // ── cards (CRM) ─────────────────────────────────────────────────────
  private cardsTotal!: Counter<'kind' | 'action'>;
  private cardRollupRunsTotal!: Counter<'status'>;

  // ── knowledge-core (Фаза 11) ────────────────────────────────────────
  // TODO (cardinality): label `tenant` потенциально безграничный — на
  //    масштабе сотен Org допустимо, но при > 1k тенантов рассмотреть
  //    замену на `tenant_bucket = hash(tenantId) % 64` или агрегацию
  //    в отдельный сборщик с ограничением series.
  private coreBlocksTotal!: Gauge<'tenant' | 'status'>;
  private coreEntitiesTotal!: Gauge<'tenant' | 'type'>;
  private coreLinksTotal!: Gauge<'tenant' | 'relation_type'>;
  private coreRawEventsTotal!: Gauge<'tenant' | 'processing_status'>;
  private corePipelineDurationSeconds!: Histogram<'worker'>;
  private coreLlmTokensTotal!: Counter<'tenant' | 'task_type'>;
  private coreRetentionDeletedTotal!: Counter<'kind'>;
  private corePersonalDataErasuresTotal!: Counter<string>;
  private coreDataClassViolationsTotal!: Counter<'task_type' | 'attempted_class'>;

  // ── extraction (Фаза 0b) ──────────────────────────────────────────
  private extractionEntitiesTotal!: Counter<'type'>;
  private extractionConfidence!: Histogram<'type'>;
  private extractionAmbiguousTotal!: Counter<'type'>;
  private entityResolutionDedupTotal!: Counter<'type' | 'action'>;

  // ── behavior metrics (Фаза B) ─────────────────────────────────────
  private behaviorMetricsComputedTotal!: Counter<string>;
  private behaviorMetricsFailedTotal!: Counter<string>;
  private behaviorMetricsLowConfidenceTotal!: Counter<string>;
  private behaviorMetricsDurationSeconds!: Histogram<string>;
  private behaviorMetricsLlmRefineTotal!: Counter<'status'>;

  // ── quality score (Фаза C) ────────────────────────────────────────
  private qualityScoreComputedTotal!: Counter<string>;
  private qualityScoreFailedTotal!: Counter<string>;
  private qualityScoreDisabledTotal!: Counter<'reason'>;
  private qualityScoreRegenerateTotal!: Counter<string>;
  private qualityScoreAvg!: Gauge<'org_id'>;
  private qualityScoreLlmCostUsd!: Counter<string>;

  // ── transcript cleaning (Фаза D) ──────────────────────────────────
  private transcriptCleaningCompletedTotal!: Counter<string>;
  private transcriptCleaningFailedTotal!: Counter<string>;
  private transcriptCleaningDurationSeconds!: Histogram<string>;
  private transcriptCleaningCharsReduced!: Histogram<string>;
  private transcriptCleaningLlmCostUsdTotal!: Counter<string>;

  // ── meeting reports (Фаза E) ──────────────────────────────────────
  private meetingReportCreatedTotal!: Counter<'kind'>;
  private meetingReportGeneratedTotal!: Counter<string>;
  private meetingReportFailedTotal!: Counter<'reason'>;
  private meetingReportRegeneratedTotal!: Counter<string>;
  private meetingReportDeletedTotal!: Counter<string>;
  private meetingReportDurationSeconds!: Histogram<string>;
  private meetingReportLlmCostUsd!: Counter<string>;

  // ── conversational channels (SBA α-1) ─────────────────────────────
  private conversationalNotificationsTotal!: Counter<'event_type' | 'status'>;
  private conversationalDeliveriesTotal!: Counter<'kind' | 'status'>;
  private conversationalInboundTotal!: Counter<'kind' | 'type'>;
  private conversationalLinkAttemptsTotal!: Counter<'kind' | 'status'>;
  private conversationalResponseTimeSeconds!: Histogram<'kind' | 'event_type'>;

  // ── telegram bot channel (SBA β-1) ────────────────────────────────
  private telegramBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private telegramBotWebhookReceivedTotal!: Counter<'type'>;

  // ── max bot channel (SBA β-1) ─────────────────────────────────────
  private maxBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private maxBotWebhookReceivedTotal!: Counter<'type'>;

  // ── core router (SBA α-3) ─────────────────────────────────────────
  private coreRouterDispatchedTotal!: Counter<'specialist' | 'signal_type'>;
  private coreRouterFanOut!: Histogram<string>;
  private coreRouterTrimmedTotal!: Counter<'signal_type'>;

  // ── curation (SBA α-4) ───────────────────────────────────────────
  private curationItemsTotal!: Counter<'resource_type' | 'level' | 'status'>;
  private curationDecisionTotal!: Counter<'decision_type' | 'level'>;
  private curationTimeToDecideSeconds!: Histogram<'level'>;
  private curationAutoCanonicalTotal!: Counter<'resource_type'>;
  private curationConflictsTotal!: Counter<'relation_type' | 'resolution'>;
  private curationStaleDetectedTotal!: Counter<'resource_type'>;

  // ── specialists (SBA α-6 — эталонный референс контракта §5 зонтичного) ──
  // Метрики единые для всех специалистов Слоя 3 (3.1..3.7). Label `type`
  // идентифицирует ресурс/специалиста: 'card' (3.4), 'regulation' (3.1),
  // 'decision' (3.3), 'insight' (3.5), 'idea' (3.6), 'skill' (3.7),
  // 'knowledge_clone' (3.2).
  private coreSpecialistCardsTotal!: Gauge<'type' | 'status'>;
  private coreSpecialistPipelineDurationSeconds!: Histogram<'type'>;
  private coreSpecialistLlmTokensTotal!: Counter<'type' | 'model' | 'tier'>;
  private coreSpecialistProbeEventsTotal!: Counter<'type' | 'reason'>;
  private coreSpecialistConflictEventsTotal!: Counter<'type'>;
  // SBA α-7 — счётчик неуспешных LLM-extraction'ов специалистов (reason:
  // 'llm_error', 'json_parse', 'schema_validation', 'arbiter_skip', ...).
  private coreSpecialistExtractionFailuresTotal!: Counter<'type' | 'reason'>;
  // SBA β-3 — evolving-конфликты (отдельный counter рядом с
  // core_specialist_conflict_events_total). Не сливаем в один counter, чтобы
  // не ломать обратную совместимость существующих label'ов.
  private coreSpecialistConflictEvolvingTotal!: Counter<'type'>;
  // SBA β-3 — гистограмма длин supersede-цепочек Decision (для аналитики
  // «как часто решения переписываются»).
  private decisionSupersedeChainLength!: Histogram<never>;

  // ── SBA β-2 — Knowledge Clone (Specialist 3.2) — два специфичных метрик'а.
  private knowledgeCloneCategoriesPerProfile!: Histogram<never>;
  private knowledgeCloneProfileSizeKb!: Histogram<never>;

  // ── SBA β-4 — Insights Radar (Specialist 3.5) ─────────────────────
  /**
   * Сколько Insight'ов сейчас в каждом dynamicLabel-сегменте (gauge).
   * label ∈ growing | stable | declining | spike.
   */
  private insightsDynamicLabelCount!: Gauge<'label'>;

  // ── SBA β-5 — Probe-Agent (Layer 6) + Ideas Collector (Specialist 3.6)
  private probeEventsTotal!: Counter<'emitted_by_service' | 'reason' | 'status'>;
  private probeDispatchedTotal!: Counter<'kind'>;
  private probeResponseTotal!: Counter<'event_type' | 'kind'>;
  private probeResponseTimeSeconds!: Histogram<'event_type' | 'kind'>;
  private probeDedupDroppedTotal!: Counter<'reason'>;
  private probeRateLimitDroppedTotal!: Counter<never>;
  private probeColdStartDroppedTotal!: Counter<never>;
  private probeExpiredTotal!: Counter<never>;
  private probeRecipientEngagementRate!: Gauge<'user_id'>;
  private ideaStatusChangeNotificationsTotal!: Counter<'new_status'>;

  // ── chat-v2 (SBA α-5) ─────────────────────────────────────────────
  private chatV2QueriesTotal!: Counter<'mode' | 'channel_origin'>;
  private chatV2RetrievalBlocks!: Histogram<'mode'>;
  private chatV2SynthesisDurationSeconds!: Histogram<'mode'>;
  private chatV2NoEvidenceTotal!: Counter<'mode'>;
  private chatV2UncertaintyMarkedTotal!: Counter<'mode'>;
  private chatV2ConversationsArchivedTotal!: Counter<'reason'>;

  // ── SBA γ-1 — SkillProfile + ExecutablePersona + Clone API ────────
  private skillProfilesActiveTotal!: Gauge<never>;
  private skillTraitsPerProfile!: Histogram<never>;
  private skillTraitsMarkedMisleadingTotal!: Counter<'category'>;
  private personaActiveTotal!: Gauge<'scope'>;
  private personaBuildDurationSeconds!: Histogram<never>;
  private cloneAskTotal!: Counter<'scope'>;
  private cloneAskByOwnerTotal!: Counter<never>;

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

    this.llmRouterDispatchTotal = this.getOrCreateCounter({
      name: 'llm_router_dispatch_total',
      help: 'Диспетчеризация задач по провайдерам в LlmRouter (status: success/fallback/failed).',
      labelNames: ['task_type', 'provider', 'status'] as const,
    });

    this.coreLlmNoProviderTotal = this.getOrCreateCounter({
      name: 'core_llm_no_provider_total',
      help: 'Фаза A.4 — ни один провайдер цепочки primary/secondary/tertiary не отработал для taskType. Должно быть = 0; > 0 → critical alert.',
      labelNames: ['task_type'] as const,
    });

    this.adminAiModelsRouteChangeTotal = this.getOrCreateCounter({
      name: 'z_admin_ai_models_route_change_total',
      help: 'Фаза A.4 — изменения цепочки моделей через /admin/ai-models (switched_primary / added_provider / removed_provider / started_ab / stopped_ab / reset_to_default).',
      labelNames: ['task_type', 'change_type'] as const,
    });

    this.adminAiModelsExperimentStartedTotal = this.getOrCreateCounter({
      name: 'z_admin_ai_models_experiment_started_total',
      help: 'Фаза A.4 — запуск A/B-эксперимента на моделях через админку.',
      labelNames: ['task_type'] as const,
    });

    this.adminAiModelsExperimentStoppedTotal = this.getOrCreateCounter({
      name: 'z_admin_ai_models_experiment_stopped_total',
      help: 'Фаза A.4 — ручная остановка A/B-эксперимента на моделях.',
      labelNames: ['task_type'] as const,
    });

    this.adminAiModelsExperimentCompletedTotal = this.getOrCreateCounter({
      name: 'z_admin_ai_models_experiment_completed_total',
      help: 'Фаза A.4 — авто-завершение A/B-эксперимента по endsAt.',
      labelNames: ['task_type'] as const,
    });

    this.promptResolverTotal = this.getOrCreateCounter({
      name: 'z_prompt_resolver_total',
      help: 'Резолв промпта AI-отчёта (Фаза A.1): откуда взят промпт.',
      labelNames: ['source'] as const,
    });

    this.promptResolverFallbackTotal = this.getOrCreateCounter({
      name: 'z_prompt_resolver_fallback_total',
      help: 'Срабатывания code-fallback в PromptResolver (Фаза A.1): db_empty / db_error.',
      labelNames: ['reason'] as const,
    });

    this.promptTemplateActiveCount = this.getOrCreateGauge({
      name: 'z_prompt_template_active_count',
      help: 'Фаза A.2 — количество активных шаблонов промптов по scope (system|org). Обновляется cron-ом раз в час.',
      labelNames: ['scope'] as const,
    });

    this.promptTemplatePreviewTotal = this.getOrCreateCounter({
      name: 'z_prompt_template_preview_total',
      help: 'Фаза A.2 — запуски preview-генерации шаблонов промптов (success|error|cost_limit).',
      labelNames: ['result'] as const,
    });

    this.promptExperimentActiveCount = this.getOrCreateGauge({
      name: 'z_prompt_experiment_active_count',
      help: 'Фаза A.3 — количество активных A/B-экспериментов по промптам.',
      labelNames: [] as const,
    });

    this.promptExperimentCompletedTotal = this.getOrCreateCounter({
      name: 'z_prompt_experiment_completed_total',
      help: 'Фаза A.3 — завершённые A/B-эксперименты по промптам (finished|stopped|expired).',
      labelNames: ['reason'] as const,
    });

    this.promptTemplateFeedbackTotal = this.getOrCreateCounter({
      name: 'z_prompt_template_feedback_total',
      help: 'Фаза A.3 — пользовательский фидбек на AI-отчёт (positive|negative).',
      labelNames: ['reaction'] as const,
    });

    this.embeddingTokensTotal = this.getOrCreateCounter({
      name: 'embedding_tokens_total',
      help: 'Сумма токенов, обработанных embedding-провайдерами (по провайдеру и статусу).',
      labelNames: ['provider', 'status'] as const,
    });

    this.embeddingChunksTotal = this.getOrCreateCounter({
      name: 'embedding_chunks_total',
      help: 'Сколько чанков транскрипта проиндексировано (по статусу).',
      labelNames: ['status'] as const,
    });

    this.mp4RenderDurationSeconds = this.getOrCreateHistogram({
      name: 'mp4_render_duration_seconds',
      help: 'Длительность ffmpeg-рендера клипа в секундах (по статусу).',
      labelNames: ['status'] as const,
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800],
    });

    this.webhookDeliveryTotal = this.getOrCreateCounter({
      name: 'webhook_delivery_total',
      help: 'Доставки исходящих webhooks (event × status: delivered/retrying/failed).',
      labelNames: ['event', 'status'] as const,
    });

    this.quotaExceededTotal = this.getOrCreateCounter({
      name: 'quota_exceeded_total',
      help: 'Срабатывания per-user квот (по имени квоты).',
      labelNames: ['quota_name'] as const,
    });

    this.exportCompletedTotal = this.getOrCreateCounter({
      name: 'export_completed_total',
      help: 'Завершённые экспорты (type × status: ready/failed).',
      labelNames: ['type', 'status'] as const,
    });

    this.chatRequestTotal = this.getOrCreateCounter({
      name: 'chat_request_total',
      help: 'AI-чат запросы по scope (single/cross/card).',
      labelNames: ['scope'] as const,
    });

    this.cardsTotal = this.getOrCreateCounter({
      name: 'cards_total',
      help: 'События с CRM-карточками (kind × action: created/updated/deleted/restored).',
      labelNames: ['kind', 'action'] as const,
    });

    this.cardRollupRunsTotal = this.getOrCreateCounter({
      name: 'card_rollup_runs_total',
      help: 'Запуски пересборки rollup-сводки карточки (success/skipped/failed).',
      labelNames: ['status'] as const,
    });

    // ── knowledge-core (Фаза 11) ─────────────────────────────────────
    this.coreBlocksTotal = this.getOrCreateGauge({
      name: 'core_blocks_total',
      help: 'Количество IdeaBlock по статусам (snapshot, обновляется CoreMetricsSnapshotCron).',
      labelNames: ['tenant', 'status'] as const,
    });
    this.coreEntitiesTotal = this.getOrCreateGauge({
      name: 'core_entities_total',
      help: 'Количество Entity по типам (snapshot).',
      labelNames: ['tenant', 'type'] as const,
    });
    this.coreLinksTotal = this.getOrCreateGauge({
      name: 'core_links_total',
      help: 'Количество IdeaBlockLink по relationType (snapshot, status=active).',
      labelNames: ['tenant', 'relation_type'] as const,
    });
    this.coreRawEventsTotal = this.getOrCreateGauge({
      name: 'core_raw_events_total',
      help: 'Количество RawEvent по processingStatus (snapshot).',
      labelNames: ['tenant', 'processing_status'] as const,
    });
    this.corePipelineDurationSeconds = this.getOrCreateHistogram({
      name: 'core_pipeline_duration_seconds',
      help: 'Длительность knowledge-core воркеров в секундах (label: worker).',
      labelNames: ['worker'] as const,
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    });
    this.coreLlmTokensTotal = this.getOrCreateCounter({
      name: 'core_llm_tokens_total',
      help: 'Сумма input+output токенов LLM-вызовов по tenant и task_type.',
      labelNames: ['tenant', 'task_type'] as const,
    });
    this.coreRetentionDeletedTotal = this.getOrCreateCounter({
      name: 'core_retention_deleted_total',
      help: 'Сколько строк удалено retention-sweep по kind (raw_event/block/chat/audit/recording).',
      labelNames: ['kind'] as const,
    });
    this.corePersonalDataErasuresTotal = this.getOrCreateCounter({
      name: 'core_personal_data_erasures_total',
      help: 'Сколько раз срабатывал DELETE /api/v1/persons/:id/data (152-ФЗ / GDPR erase).',
    });
    this.coreDataClassViolationsTotal = this.getOrCreateCounter({
      name: 'core_data_class_violations_total',
      help: 'Попытки отправить sensitive/private данные в неподходящий LLM-провайдер. Должно быть = 0.',
      labelNames: ['task_type', 'attempted_class'] as const,
    });

    // ── extraction (Фаза 0b) ──────────────────────────────────────
    this.extractionEntitiesTotal = this.getOrCreateCounter({
      name: 'z_extraction_entities_total',
      help: 'Количество извлечённых типизированных сущностей группы Б по типу (process/decision/regulation/policy/metric/tool).',
      labelNames: ['type'] as const,
    });
    this.extractionConfidence = this.getOrCreateHistogram({
      name: 'z_extraction_confidence',
      help: 'Распределение confidence извлечённых сущностей группы Б по типу.',
      labelNames: ['type'] as const,
      buckets: [0.1, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0],
    });
    this.extractionAmbiguousTotal = this.getOrCreateCounter({
      name: 'z_extraction_ambiguous_total',
      help: 'Сколько сущностей помечены как ambiguous (LLM колеблется между несколькими типами).',
      labelNames: ['type'] as const,
    });
    this.entityResolutionDedupTotal = this.getOrCreateCounter({
      name: 'z_entity_resolution_dedup_total',
      help: 'Действия EntityResolutionService при дедупе типизированных сущностей (action: merged | created | resolved).',
      labelNames: ['type', 'action'] as const,
    });

    // ── behavior metrics (Фаза B) ─────────────────────────────────
    this.behaviorMetricsComputedTotal = this.getOrCreateCounter({
      name: 'z_behavior_metrics_computed_total',
      help: 'Сколько встреч успешно посчитали behavior-метрики.',
      labelNames: [] as const,
    });
    this.behaviorMetricsFailedTotal = this.getOrCreateCounter({
      name: 'z_behavior_metrics_failed_total',
      help: 'Сколько раз воркер ai.behavior-metrics упал после всех ретраев.',
      labelNames: [] as const,
    });
    this.behaviorMetricsLowConfidenceTotal = this.getOrCreateCounter({
      name: 'z_behavior_metrics_low_confidence_total',
      help: 'Сколько встреч помечены lowConfidence (короткая встреча / низкое качество диаризации).',
      labelNames: [] as const,
    });
    this.behaviorMetricsDurationSeconds = this.getOrCreateHistogram({
      name: 'z_behavior_metrics_duration_seconds',
      help: 'Длительность одного запуска воркера ai.behavior-metrics, секунд.',
      labelNames: [] as const,
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    });
    this.behaviorMetricsLlmRefineTotal = this.getOrCreateCounter({
      name: 'z_behavior_metrics_llm_refine_total',
      help: 'Сколько раз вызывали LLM-refine в behavior-pipeline (status: success | failed).',
      labelNames: ['status'] as const,
    });

    // ── quality score (Фаза C) ──────────────────────────────────────
    this.qualityScoreComputedTotal = this.getOrCreateCounter({
      name: 'z_quality_score_computed_total',
      help: 'Сколько встреч успешно посчитали AI-оценку качества.',
      labelNames: [] as const,
    });
    this.qualityScoreFailedTotal = this.getOrCreateCounter({
      name: 'z_quality_score_failed_total',
      help: 'Сколько раз воркер ai.quality-score упал после всех ретраев.',
      labelNames: [] as const,
    });
    this.qualityScoreDisabledTotal = this.getOrCreateCounter({
      name: 'z_quality_score_disabled_total',
      help: 'Сколько раз скип расчёта AI-оценки (reason: too_short | org_setting).',
      labelNames: ['reason'] as const,
    });
    this.qualityScoreRegenerateTotal = this.getOrCreateCounter({
      name: 'z_quality_score_regenerate_total',
      help: 'Сколько раз вызывали POST /meetings/:id/quality-score/regenerate.',
      labelNames: [] as const,
    });
    this.qualityScoreAvg = this.getOrCreateGauge({
      name: 'z_quality_score_avg',
      help: 'Средний overallScore встреч Org (обновляется внешним cron-job или сервисом).',
      labelNames: ['org_id'] as const,
    });
    this.qualityScoreLlmCostUsd = this.getOrCreateCounter({
      name: 'z_quality_score_llm_cost_usd',
      help: 'Суммарная стоимость LLM-вызовов воркера ai.quality-score, USD.',
      labelNames: [] as const,
    });

    // ── transcript cleaning (Фаза D) ───────────────────────────────
    this.transcriptCleaningCompletedTotal = this.getOrCreateCounter({
      name: 'z_transcript_cleaning_completed_total',
      help: 'Сколько встреч успешно прошли очистку транскрипта от слов-паразитов.',
      labelNames: [] as const,
    });
    this.transcriptCleaningFailedTotal = this.getOrCreateCounter({
      name: 'z_transcript_cleaning_failed_total',
      help: 'Сколько раз воркер ai.transcript-clean упал окончательно.',
      labelNames: [] as const,
    });
    this.transcriptCleaningDurationSeconds = this.getOrCreateHistogram({
      name: 'z_transcript_cleaning_duration_seconds',
      help: 'Длительность одного запуска ai.transcript-clean, секунд.',
      labelNames: [] as const,
      buckets: [0.5, 1, 3, 10, 30, 60, 120, 300],
    });
    this.transcriptCleaningCharsReduced = this.getOrCreateHistogram({
      name: 'z_transcript_cleaning_chars_reduced',
      help: 'Доля удалённых символов (charsBefore - charsAfter) / charsBefore. Значение 0..1.',
      labelNames: [] as const,
      buckets: [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5],
    });
    this.transcriptCleaningLlmCostUsdTotal = this.getOrCreateCounter({
      name: 'z_transcript_cleaning_llm_cost_usd',
      help: 'Суммарная стоимость LLM-refine для очистки транскрипта в USD.',
      labelNames: [] as const,
    });

    // ── meeting reports (Фаза E) ──────────────────────────────────
    this.meetingReportCreatedTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_created_total',
      help: 'Фаза E — создание нового MeetingReport (kind=additional). Фиксируется в момент POST /meetings/:id/reports.',
      labelNames: ['kind'] as const,
    });
    this.meetingReportGeneratedTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_generated_total',
      help: 'Фаза E — успешно сгенерированные дополнительные отчёты (status=ready).',
      labelNames: [] as const,
    });
    this.meetingReportFailedTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_failed_total',
      help: 'Фаза E — отчёты, упавшие после всех ретраев (llm_error | cost_limit | other).',
      labelNames: ['reason'] as const,
    });
    this.meetingReportRegeneratedTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_regenerated_total',
      help: 'Фаза E — запуск регенерации существующего MeetingReport.',
      labelNames: [] as const,
    });
    this.meetingReportDeletedTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_deleted_total',
      help: 'Фаза E — soft-удаление MeetingReport (status=archived).',
      labelNames: [] as const,
    });
    this.meetingReportDurationSeconds = this.getOrCreateHistogram({
      name: 'z_meeting_report_duration_seconds',
      help: 'Фаза E — длительность одной job custom-report (от старта воркера до ready/failed).',
      labelNames: [] as const,
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1200],
    });
    this.meetingReportLlmCostUsd = this.getOrCreateCounter({
      name: 'z_meeting_report_llm_cost_usd',
      help: 'Фаза E — оценочная суммарная стоимость LLM-вызовов custom-report (USD).',
      labelNames: [] as const,
    });

    // ── conversational channels (SBA α-1) ──────────────────────────
    this.conversationalNotificationsTotal = this.getOrCreateCounter({
      name: 'conversational_notifications_total',
      help: 'События ConversationalModule: создание/доставка/чтение/ответ/отказ нотификации (по eventType и status).',
      labelNames: ['event_type', 'status'] as const,
    });
    this.conversationalDeliveriesTotal = this.getOrCreateCounter({
      name: 'conversational_deliveries_total',
      help: 'Попытки доставки notification в конкретный channel (kind × status).',
      labelNames: ['kind', 'status'] as const,
    });
    this.conversationalInboundTotal = this.getOrCreateCounter({
      name: 'conversational_inbound_total',
      help: 'Inbound-сообщения, принятые ConversationalModule (kind × тип сообщения).',
      labelNames: ['kind', 'type'] as const,
    });
    this.conversationalLinkAttemptsTotal = this.getOrCreateCounter({
      name: 'conversational_link_attempts_total',
      help: 'Попытки привязки канала пользователя: generated / verified / invalid_code (по типу канала).',
      labelNames: ['kind', 'status'] as const,
    });
    this.conversationalResponseTimeSeconds = this.getOrCreateHistogram({
      name: 'conversational_response_time_seconds',
      help: 'Время ответа пользователя на probe-нотификацию (секунды, по kind × eventType).',
      labelNames: ['kind', 'event_type'] as const,
      buckets: [10, 60, 300, 900, 1800, 3600, 14_400, 86_400, 604_800],
    });

    // ── telegram bot (SBA β-1) ─────────────────────────────────────
    this.telegramBotApiErrorsTotal = this.getOrCreateCounter({
      name: 'telegram_bot_api_errors_total',
      help: 'SBA β-1 — ошибки вызовов Telegram Bot API (api_method × HTTP/Telegram code).',
      labelNames: ['api_method', 'code'] as const,
    });
    this.telegramBotWebhookReceivedTotal = this.getOrCreateCounter({
      name: 'telegram_bot_webhook_received_total',
      help: 'SBA β-1 — webhook Update от Telegram (type = message/callback_query/command/...).',
      labelNames: ['type'] as const,
    });

    // ── max bot (SBA β-1) ──────────────────────────────────────────
    this.maxBotApiErrorsTotal = this.getOrCreateCounter({
      name: 'max_bot_api_errors_total',
      help: 'SBA β-1 — ошибки вызовов MAX Bot API (api_method × HTTP/MAX code).',
      labelNames: ['api_method', 'code'] as const,
    });
    this.maxBotWebhookReceivedTotal = this.getOrCreateCounter({
      name: 'max_bot_webhook_received_total',
      help: 'SBA β-1 — webhook Update от MAX (type = message_created/callback/command/...).',
      labelNames: ['type'] as const,
    });

    // ── core router (SBA α-3) ──────────────────────────────────────
    this.coreRouterDispatchedTotal = this.getOrCreateCounter({
      name: 'core_router_dispatched_total',
      help: 'SBA α-3 — RouterService.dispatch: количество jobs, отправленных специалистам Слоя 3 (по specialist × signal_type).',
      labelNames: ['specialist', 'signal_type'] as const,
    });
    this.coreRouterFanOut = this.getOrCreateHistogram({
      name: 'core_router_fan_out',
      help: 'SBA α-3 — RouterService: распределение количества специалистов на один блок. > maxSpecialistsPerBlock — анти-fan-out срабатывает.',
      labelNames: [] as const,
      buckets: [0, 1, 2, 3, 4, 5, 6, 8, 10],
    });
    this.coreRouterTrimmedTotal = this.getOrCreateCounter({
      name: 'core_router_trimmed_total',
      help: 'SBA α-3 — RouterService: блоки, где сработало ограничение maxSpecialistsPerBlock (часть специалистов отброшена по приоритету).',
      labelNames: ['signal_type'] as const,
    });

    // ── curation (SBA α-4) ───────────────────────────────────────
    this.curationItemsTotal = this.getOrCreateCounter({
      name: 'curation_items_total',
      help: 'SBA α-4 — CurationItem: счётчик созданных/перешедших по статусу карточек (resource_type × level × status).',
      labelNames: ['resource_type', 'level', 'status'] as const,
    });
    this.curationDecisionTotal = this.getOrCreateCounter({
      name: 'curation_decision_total',
      help: 'SBA α-4 — CurationDecision: счётчик принятых решений (decision_type × level).',
      labelNames: ['decision_type', 'level'] as const,
    });
    this.curationTimeToDecideSeconds = this.getOrCreateHistogram({
      name: 'curation_time_to_decide_seconds',
      help: 'SBA α-4 — Время с момента создания CurationItem до принятия решения (секунды, по level).',
      labelNames: ['level'] as const,
      buckets: [60, 300, 900, 3600, 14_400, 86_400, 259_200, 604_800],
    });
    this.curationAutoCanonicalTotal = this.getOrCreateCounter({
      name: 'curation_auto_canonical_total',
      help: 'SBA α-4 — Карточки, прошедшие auto-canonical через triage (без CurationItem).',
      labelNames: ['resource_type'] as const,
    });
    this.curationConflictsTotal = this.getOrCreateCounter({
      name: 'curation_conflicts_total',
      help: 'SBA α-4 — ConflictItem: создания и резолюции (relation_type × resolution; для created — resolution="created").',
      labelNames: ['relation_type', 'resolution'] as const,
    });
    this.curationStaleDetectedTotal = this.getOrCreateCounter({
      name: 'curation_stale_detected_total',
      help: 'SBA α-4 — CardStaleDetectorCron: сколько карточек помечено кандидатами на stale (resource_type).',
      labelNames: ['resource_type'] as const,
    });

    // ── specialists (SBA α-6 — единый контракт §5 для Слоя 3) ────────
    this.coreSpecialistCardsTotal = this.getOrCreateGauge({
      name: 'core_specialist_cards_total',
      help: 'SBA α-6 — карточки специалистов Слоя 3 (type × status). type=card/regulation/decision/insight/idea/skill/knowledge_clone; status=canonical/pending/draft/archived.',
      labelNames: ['type', 'status'] as const,
    });
    this.coreSpecialistPipelineDurationSeconds = this.getOrCreateHistogram({
      name: 'core_specialist_pipeline_duration_seconds',
      help: 'SBA α-6 — длительность полного цикла специалиста (от старта job до результата) в секундах (type).',
      labelNames: ['type'] as const,
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    });
    this.coreSpecialistLlmTokensTotal = this.getOrCreateCounter({
      name: 'core_specialist_llm_tokens_total',
      help: 'SBA α-6 — токены LLM, потраченные специалистом (type × model × tier). tier=primary/secondary/tertiary.',
      labelNames: ['type', 'model', 'tier'] as const,
    });
    this.coreSpecialistProbeEventsTotal = this.getOrCreateCounter({
      name: 'core_specialist_probe_events_total',
      help: 'SBA α-6 — probe-events, отправленные специалистом (type × reason). reason — `card.missing_owner` / `card.missing_deadline` / `card.merge_suggestion` / `card.outdated_summary` и т.п.',
      labelNames: ['type', 'reason'] as const,
    });
    this.coreSpecialistConflictEventsTotal = this.getOrCreateCounter({
      name: 'core_specialist_conflict_events_total',
      help: 'SBA α-6 — conflict-events, репортированные специалистом через ConflictService.report (type).',
      labelNames: ['type'] as const,
    });
    this.coreSpecialistExtractionFailuresTotal = this.getOrCreateCounter({
      name: 'core_specialist_extraction_failures_total',
      help: 'SBA α-7 — провалы LLM-extraction специалистов Слоя 3 (type × reason). reason: `llm_error`/`json_parse`/`schema_validation`/`arbiter_skip`/`db_error`.',
      labelNames: ['type', 'reason'] as const,
    });
    // SBA β-3 — evolving-конфликты (отдельный counter).
    this.coreSpecialistConflictEvolvingTotal = this.getOrCreateCounter({
      name: 'core_specialist_conflict_evolving_total',
      help: 'SBA β-3 — конфликты с suggested resolution=evolving, репортированные специалистами (type). Для Decision: новая версия → старая → ConflictItem(evolving).',
      labelNames: ['type'] as const,
    });
    // SBA β-3 — длина supersede-цепочек Decision.
    this.decisionSupersedeChainLength = this.getOrCreateHistogram({
      name: 'decision_supersede_chain_length',
      help: 'SBA β-3 — длина supersede-цепочек Decision (chain length = сколько раз решение переписывалось). 0 — изначальное, 1 — заменено один раз, и т.д.',
      labelNames: [] as const,
      buckets: [0, 1, 2, 3, 5, 8, 13, 21],
    });

    // ── SBA β-2 — Knowledge Clone (Specialist 3.2) ──
    this.knowledgeCloneCategoriesPerProfile = this.getOrCreateHistogram({
      name: 'knowledge_clone_categories_per_profile',
      help: 'SBA β-2 — распределение числа категорий в knowledgeProfile (per rebuild).',
      labelNames: [] as const,
      buckets: [0, 1, 3, 5, 8, 12, 18, 25, 40],
    });
    this.knowledgeCloneProfileSizeKb = this.getOrCreateHistogram({
      name: 'knowledge_clone_profile_size_kb',
      help: 'SBA β-2 — распределение размера сериализованного knowledgeProfile (KB).',
      labelNames: [] as const,
      buckets: [0.5, 1, 2, 4, 8, 16, 32, 64, 128],
    });

    // ── SBA β-4 — Insights Radar (Specialist 3.5) ──
    this.insightsDynamicLabelCount = this.getOrCreateGauge({
      name: 'insights_dynamic_label_count',
      help: 'SBA β-4 — сколько активных Insight\'ов сейчас в каждом dynamicLabel-сегменте (label: growing | stable | declining | spike).',
      labelNames: ['label'] as const,
    });

    // ── SBA β-5 — Probe-Agent + Ideas Collector ──
    this.probeEventsTotal = this.getOrCreateCounter({
      name: 'probe_events_total',
      help: 'SBA β-5 — probe-события: сколько создано / отброшено (emitted_by_service × reason × status).',
      labelNames: ['emitted_by_service', 'reason', 'status'] as const,
    });
    this.probeDispatchedTotal = this.getOrCreateCounter({
      name: 'probe_dispatched_total',
      help: 'SBA β-5 — сколько probe-событий доставлено в канал (kind).',
      labelNames: ['kind'] as const,
    });
    this.probeResponseTotal = this.getOrCreateCounter({
      name: 'probe_response_total',
      help: 'SBA β-5 — сколько probe-событий получили ответ (event_type × kind).',
      labelNames: ['event_type', 'kind'] as const,
    });
    this.probeResponseTimeSeconds = this.getOrCreateHistogram({
      name: 'probe_response_time_seconds',
      help: 'SBA β-5 — время от dispatch до ответа (event_type × kind), секунды.',
      labelNames: ['event_type', 'kind'] as const,
      buckets: [10, 60, 300, 900, 3600, 14400, 86400, 604800],
    });
    this.probeDedupDroppedTotal = this.getOrCreateCounter({
      name: 'probe_dedup_dropped_total',
      help: 'SBA β-5 — сколько probe-событий отброшено по дедупликации (reason).',
      labelNames: ['reason'] as const,
    });
    this.probeRateLimitDroppedTotal = this.getOrCreateCounter({
      name: 'probe_rate_limit_dropped_total',
      help: 'SBA β-5 — сколько probe-событий отброшено по rate-limit\'у получателя.',
      labelNames: [] as const,
    });
    this.probeColdStartDroppedTotal = this.getOrCreateCounter({
      name: 'probe_cold_start_dropped_total',
      help: 'SBA β-5 — сколько probe-событий отложено по cold-start mode (первые 24h после первого probe).',
      labelNames: [] as const,
    });
    this.probeExpiredTotal = this.getOrCreateCounter({
      name: 'probe_expired_total',
      help: 'SBA β-5 — сколько probe-событий истекло без ответа.',
      labelNames: [] as const,
    });
    this.probeRecipientEngagementRate = this.getOrCreateGauge({
      name: 'probe_recipient_engagement_rate',
      help: 'SBA β-5 — отзывчивость получателя за 30 дней (отвечено / отправлено), per user.',
      labelNames: ['user_id'] as const,
    });
    this.ideaStatusChangeNotificationsTotal = this.getOrCreateCounter({
      name: 'idea_status_change_notifications_total',
      help: 'SBA β-5 — сколько уведомлений о смене статуса идеи отправлено supporter\'ам (new_status).',
      labelNames: ['new_status'] as const,
    });

    // ── chat-v2 (SBA α-5) ────────────────────────────────────────────
    this.chatV2QueriesTotal = this.getOrCreateCounter({
      name: 'chat_v2_queries_total',
      help: 'SBA α-5 — chat-v2: количество запросов (mode × channel_origin).',
      labelNames: ['mode', 'channel_origin'] as const,
    });
    this.chatV2RetrievalBlocks = this.getOrCreateHistogram({
      name: 'chat_v2_retrieval_blocks',
      help: 'SBA α-5 — chat-v2: распределение числа блоков, использованных в ответе AI (mode).',
      labelNames: ['mode'] as const,
      buckets: [0, 1, 2, 4, 8, 12, 16, 20, 30],
    });
    this.chatV2SynthesisDurationSeconds = this.getOrCreateHistogram({
      name: 'chat_v2_synthesis_duration_seconds',
      help: 'SBA α-5 — chat-v2: длительность synthesis (retrieval + LLM call), секунды (mode).',
      labelNames: ['mode'] as const,
      buckets: [0.5, 1, 2, 5, 10, 20, 40, 60, 120],
    });
    this.chatV2NoEvidenceTotal = this.getOrCreateCounter({
      name: 'chat_v2_no_evidence_total',
      help: 'SBA α-5 — chat-v2: ответы без citations (плохой UX — AI выдумал или ничего не нашёл) (mode).',
      labelNames: ['mode'] as const,
    });
    this.chatV2UncertaintyMarkedTotal = this.getOrCreateCounter({
      name: 'chat_v2_uncertainty_marked_total',
      help: 'SBA α-5 — chat-v2: ответы с пометкой uncertaintyNote (есть конфликты в источниках) (mode).',
      labelNames: ['mode'] as const,
    });
    this.chatV2ConversationsArchivedTotal = this.getOrCreateCounter({
      name: 'chat_v2_conversations_archived_total',
      help: 'SBA α-5 — chat-v2: количество архивированных диалогов (reason: ttl/manual).',
      labelNames: ['reason'] as const,
    });

    // ── SBA γ-1 — SkillProfile + ExecutablePersona + Clone API ──────
    this.skillProfilesActiveTotal = this.getOrCreateGauge({
      name: 'skill_profiles_active_total',
      help: 'SBA γ-1 — сколько активных SkillProfile сейчас в системе (gauge).',
      labelNames: [] as const,
    });
    this.skillTraitsPerProfile = this.getOrCreateHistogram({
      name: 'skill_traits_per_profile',
      help: 'SBA γ-1 — распределение числа active traits в SkillProfile.',
      labelNames: [] as const,
      buckets: [0, 1, 3, 5, 8, 12, 18, 25, 40],
    });
    this.skillTraitsMarkedMisleadingTotal = this.getOrCreateCounter({
      name: 'skill_traits_marked_misleading_total',
      help: 'SBA γ-1 — сколько SkillTrait помечено как misleading direct manager/admin (для тюна промпта).',
      labelNames: ['category'] as const,
    });
    this.personaActiveTotal = this.getOrCreateGauge({
      name: 'persona_active_total',
      help: 'SBA γ-1 — сколько active ExecutablePersona (gauge, scope: person | role).',
      labelNames: ['scope'] as const,
    });
    this.personaBuildDurationSeconds = this.getOrCreateHistogram({
      name: 'persona_build_duration_seconds',
      help: 'SBA γ-1 — длительность сборки одной ExecutablePersona (secondsdes).',
      labelNames: [] as const,
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    });
    this.cloneAskTotal = this.getOrCreateCounter({
      name: 'clone_ask_total',
      help: 'SBA γ-1 — сколько раз вызван Clone API (scope: person | role).',
      labelNames: ['scope'] as const,
    });
    this.cloneAskByOwnerTotal = this.getOrCreateCounter({
      name: 'clone_ask_by_owner_total',
      help: 'SBA γ-1 — сколько раз носитель спросил своего же клона (engagement).',
      labelNames: [] as const,
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

  /**
   * PromptResolver (Фаза A.1): инкрементирует, какой источник промпта был
   * использован. source = 'db_org' | 'db_system' | 'code_fallback'.
   */
  incPromptResolver(args: { source: 'db_org' | 'db_system' | 'code_fallback' }): void {
    this.promptResolverTotal.inc({ source: args.source });
  }

  /**
   * PromptResolver (Фаза A.1): фоллбек на код. reason = 'db_empty' | 'db_error'.
   */
  incPromptResolverFallback(args: { reason: 'db_empty' | 'db_error' }): void {
    this.promptResolverFallbackTotal.inc({ reason: args.reason });
  }

  /**
   * Фаза A.2 — gauge числа активных шаблонов промптов по scope. Обновляется
   * cron-ом (TODO в фазе A.3). scope = 'system' | 'org'.
   */
  setPromptTemplateActiveCount(args: { scope: 'system' | 'org'; count: number }): void {
    this.promptTemplateActiveCount.set({ scope: args.scope }, args.count);
  }

  /**
   * Фаза A.2 — счётчик запусков preview шаблона. result = 'success' | 'error' | 'cost_limit'.
   */
  incPromptTemplatePreview(args: { result: 'success' | 'error' | 'cost_limit' }): void {
    this.promptTemplatePreviewTotal.inc({ result: args.result });
  }

  /**
   * Фаза A.3 — gauge активных A/B-экспериментов по промптам.
   */
  setPromptExperimentActiveCount(args: { count: number }): void {
    this.promptExperimentActiveCount.set(args.count);
  }

  /**
   * Фаза A.3 — счётчик завершённых экспериментов. reason = 'finished' | 'stopped' | 'expired'.
   */
  incPromptExperimentCompleted(args: { reason: 'finished' | 'stopped' | 'expired' }): void {
    this.promptExperimentCompletedTotal.inc({ reason: args.reason });
  }

  /**
   * Фаза A.3 — счётчик фидбека на AI-отчёт. reaction = 'positive' | 'negative'.
   */
  incPromptTemplateFeedback(args: { reaction: 'positive' | 'negative' }): void {
    this.promptTemplateFeedbackTotal.inc({ reaction: args.reaction });
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

  /**
   * Диспетчеризация задачи в LlmRouter.
   *   status='success'  — провайдер вернул валидный ответ.
   *   status='fallback' — провайдер упал, перешли к следующему.
   *   status='failed'   — все провайдеры упали.
   */
  incLlmRouterDispatch(args: {
    taskType: string;
    provider: string;
    status: 'success' | 'fallback' | 'failed';
  }): void {
    this.llmRouterDispatchTotal.inc({
      task_type: args.taskType,
      provider: args.provider,
      status: args.status,
    });
  }

  /**
   * Фаза A.4 — все 3 tier'а (primary/secondary/tertiary) упали для taskType.
   * Это критическая ситуация: ни один провайдер не отработал.
   */
  incCoreLlmNoProvider(args: { taskType: string }): void {
    this.coreLlmNoProviderTotal.inc({ task_type: args.taskType });
  }

  /**
   * Фаза A.4 — изменение цепочки моделей в /admin/ai-models. changeType:
   * 'switched_primary' | 'added_provider' | 'removed_provider' | 'started_ab' |
   * 'stopped_ab' | 'reset_to_default'.
   */
  incAdminAiModelsRouteChange(args: {
    taskType: string;
    changeType: string;
  }): void {
    this.adminAiModelsRouteChangeTotal.inc({
      task_type: args.taskType,
      change_type: args.changeType,
    });
  }

  /** Фаза A.4 — старт A/B-эксперимента на моделях. */
  incAdminAiModelsExperimentStarted(args: { taskType: string }): void {
    this.adminAiModelsExperimentStartedTotal.inc({ task_type: args.taskType });
  }

  /** Фаза A.4 — ручная остановка A/B-эксперимента на моделях. */
  incAdminAiModelsExperimentStopped(args: { taskType: string }): void {
    this.adminAiModelsExperimentStoppedTotal.inc({ task_type: args.taskType });
  }

  /** Фаза A.4 — авто-завершение A/B-эксперимента (по endsAt). */
  incAdminAiModelsExperimentCompleted(args: { taskType: string }): void {
    this.adminAiModelsExperimentCompletedTotal.inc({ task_type: args.taskType });
  }

  /**
   * Кол-во токенов, обработанных embedding-провайдером.
   *   status='success' | 'failed'.
   */
  addEmbeddingTokens(args: {
    provider: string;
    status: 'success' | 'failed';
    tokens: number;
  }): void {
    if (args.tokens <= 0) return;
    this.embeddingTokensTotal.inc({ provider: args.provider, status: args.status }, args.tokens);
  }

  addEmbeddingChunks(args: { status: 'success' | 'failed'; count: number }): void {
    if (args.count <= 0) return;
    this.embeddingChunksTotal.inc({ status: args.status }, args.count);
  }

  observeMp4RenderDuration(args: { status: string; seconds: number }): void {
    this.mp4RenderDurationSeconds.observe({ status: args.status }, args.seconds);
  }

  // ────────────────────── ai-workspace ─────────────────────────────────

  /** Доставка webhook'а: status — delivered / retrying / failed. */
  incWebhookDelivery(args: { event: string; status: 'delivered' | 'retrying' | 'failed' }): void {
    this.webhookDeliveryTotal.inc({ event: args.event, status: args.status });
  }

  /** Срабатывание квоты (429). */
  incQuotaExceeded(args: { quotaName: string }): void {
    this.quotaExceededTotal.inc({ quota_name: args.quotaName });
  }

  /** Завершение экспорта. */
  incExportCompleted(args: { type: string; status: 'ready' | 'failed' }): void {
    this.exportCompletedTotal.inc({ type: args.type, status: args.status });
  }

  /** AI-чат запрос: scope = single | cross | card. */
  incChatRequest(args: { scope: 'single' | 'cross' | 'card' }): void {
    this.chatRequestTotal.inc({ scope: args.scope });
  }

  /** Создание/обновление/удаление карточки. */
  incCardEvent(args: {
    kind: string;
    action: 'created' | 'updated' | 'deleted' | 'restored';
  }): void {
    this.cardsTotal.inc({ kind: args.kind, action: args.action });
  }

  /** Запуск card-rollup воркера. */
  incCardRollupRun(args: { status: 'success' | 'skipped' | 'failed' }): void {
    this.cardRollupRunsTotal.inc({ status: args.status });
  }

  // ────────────────────── knowledge-core (Фаза 11) ─────────────────────

  /**
   * Удаление retention'ом строки/группы строк по kind.
   * kind = 'raw_event' | 'block' | 'chat' | 'audit' | 'recording'.
   */
  incCoreRetentionDeleted(args: { kind: string; count?: number }): void {
    const n = args.count ?? 1;
    if (n <= 0) return;
    this.coreRetentionDeletedTotal.inc({ kind: args.kind }, n);
  }

  /**
   * Срабатывание eraseEntity (152-ФЗ / GDPR data erase).
   * Должен быть редким — дашборд алертит при > 5/день.
   */
  incCorePersonalDataErasure(): void {
    this.corePersonalDataErasuresTotal.inc(1);
  }

  /**
   * Попытка отправить sensitive/private данные в провайдер, чей
   * `maxDataClass` ниже требуемого. Должна быть = 0 на проде; > 0 →
   * critical alert.
   */
  incCoreDataClassViolation(args: { taskType: string; attemptedClass: string }): void {
    this.coreDataClassViolationsTotal.inc({
      task_type: args.taskType,
      attempted_class: args.attemptedClass,
    });
  }

  /**
   * Обновляет gauge `core_blocks_total{tenant,status}` для одной комбинации.
   * Вызывается CoreMetricsSnapshotCron'ом по результатам group-by SELECT.
   */
  setCoreBlocks(args: { tenant: string; status: string; count: number }): void {
    this.coreBlocksTotal.set({ tenant: args.tenant, status: args.status }, args.count);
  }

  setCoreEntities(args: { tenant: string; type: string; count: number }): void {
    this.coreEntitiesTotal.set({ tenant: args.tenant, type: args.type }, args.count);
  }

  setCoreLinks(args: { tenant: string; relationType: string; count: number }): void {
    this.coreLinksTotal.set(
      { tenant: args.tenant, relation_type: args.relationType },
      args.count,
    );
  }

  setCoreRawEvents(args: {
    tenant: string;
    processingStatus: string;
    count: number;
  }): void {
    this.coreRawEventsTotal.set(
      { tenant: args.tenant, processing_status: args.processingStatus },
      args.count,
    );
  }

  /** Длительность завершившегося воркера knowledge-core (в секундах). */
  observeCorePipelineDuration(args: { worker: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.corePipelineDurationSeconds.observe({ worker: args.worker }, args.seconds);
  }

  /**
   * Сумма input+output токенов одного LLM-вызова. Вызывается
   * AiUsageLogService после успешной записи (см. шаг 8 ТЗ).
   */
  addCoreLlmTokens(args: {
    tenant: string;
    taskType: string;
    tokens: number;
  }): void {
    if (args.tokens <= 0) return;
    this.coreLlmTokensTotal.inc(
      { tenant: args.tenant, task_type: args.taskType },
      args.tokens,
    );
  }

  // ────────────────────── extraction (Фаза 0b) ─────────────────────────

  /**
   * Инкремент счётчика извлечённых сущностей группы Б.
   * type ∈ {process, decision, regulation, policy, metric, tool}.
   */
  incExtractionEntity(args: { type: string; count?: number }): void {
    const n = args.count ?? 1;
    if (n <= 0) return;
    this.extractionEntitiesTotal.inc({ type: args.type }, n);
  }

  /** Распределение confidence извлечённой сущности. 0..1. */
  observeExtractionConfidence(args: { type: string; confidence: number }): void {
    if (args.confidence < 0 || args.confidence > 1) return;
    this.extractionConfidence.observe({ type: args.type }, args.confidence);
  }

  /** Ambiguous-кейс (LLM вернул несколько кандидатов типа). */
  incExtractionAmbiguous(args: { type: string }): void {
    this.extractionAmbiguousTotal.inc({ type: args.type });
  }

  /**
   * Дедуп типизированной сущности. action ∈ {merged, created, resolved}:
   *   - merged — найден существующий по точному совпадению или cosine.
   *   - created — создана новая.
   *   - resolved — резолвен hint (role/person) в существующий id.
   */
  incEntityResolutionDedup(args: { type: string; action: string }): void {
    this.entityResolutionDedupTotal.inc({
      type: args.type,
      action: args.action,
    });
  }

  // ────────────────────── behavior metrics (Фаза B) ───────────────────

  /** Успешный расчёт behavior-метрик одной встречи. */
  incBehaviorMetricsComputed(): void {
    this.behaviorMetricsComputedTotal.inc();
  }

  /** Воркер ai.behavior-metrics упал после всех ретраев. */
  incBehaviorMetricsFailed(): void {
    this.behaviorMetricsFailedTotal.inc();
  }

  /** Встреча помечена как lowConfidence (короткая / низкое качество диаризации). */
  incBehaviorMetricsLowConfidence(): void {
    this.behaviorMetricsLowConfidenceTotal.inc();
  }

  /** Гистограмма длительности воркера. */
  observeBehaviorMetricsDuration(seconds: number): void {
    this.behaviorMetricsDurationSeconds.observe(seconds);
  }

  /** Вызов LLM-refine: status = 'success' | 'failed'. */
  incBehaviorMetricsLlmRefine(args: { status: 'success' | 'failed' }): void {
    this.behaviorMetricsLlmRefineTotal.inc({ status: args.status });
  }

  // ────────────────────── quality score (Фаза C) ──────────────────────

  /** Успешный расчёт AI-оценки качества одной встречи. */
  incQualityScoreComputed(): void {
    this.qualityScoreComputedTotal.inc();
  }

  /** Воркер ai.quality-score упал после всех ретраев. */
  incQualityScoreFailed(): void {
    this.qualityScoreFailedTotal.inc();
  }

  /** Скип расчёта по причине too_short или org_setting. */
  incQualityScoreDisabled(args: { reason: 'too_short' | 'org_setting' }): void {
    this.qualityScoreDisabledTotal.inc({ reason: args.reason });
  }

  /** Вызов POST /meetings/:id/quality-score/regenerate. */
  incQualityScoreRegenerate(): void {
    this.qualityScoreRegenerateTotal.inc();
  }

  /** Установить gauge со средним overallScore Org. */
  setQualityScoreAvg(orgId: string, avg: number): void {
    this.qualityScoreAvg.set({ org_id: orgId }, avg);
  }

  /** Прибавить стоимость LLM-вызова quality-score (USD). */
  incQualityScoreLlmCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.qualityScoreLlmCostUsd.inc(usd);
  }

  // ────────────────────── transcript cleaning (Фаза D) ────────────────

  /** Успешная очистка транскрипта одной встречи. */
  incTranscriptCleaningCompleted(): void {
    this.transcriptCleaningCompletedTotal.inc();
  }

  /** Воркер ai.transcript-clean упал после всех ретраев. */
  incTranscriptCleaningFailed(): void {
    this.transcriptCleaningFailedTotal.inc();
  }

  /** Длительность одной job'ы очистки транскрипта, секунд. */
  observeTranscriptCleaningDuration(seconds: number): void {
    this.transcriptCleaningDurationSeconds.observe(seconds);
  }

  /** Доля удалённых символов (0..1). */
  observeTranscriptCleaningCharsReduced(ratio: number): void {
    this.transcriptCleaningCharsReduced.observe(Math.max(0, Math.min(1, ratio)));
  }

  /** Стоимость LLM-refine в USD. */
  addTranscriptCleaningLlmCostUsd(usd: number): void {
    if (usd > 0) this.transcriptCleaningLlmCostUsdTotal.inc(usd);
  }

  // ────────────────────── meeting reports (Фаза E) ────────────────

  /** Создание новой записи MeetingReport (kind = 'primary' | 'additional'). */
  incMeetingReportCreated(args: { kind: 'primary' | 'additional' }): void {
    this.meetingReportCreatedTotal.inc({ kind: args.kind });
  }

  /** Успешная генерация отчёта (status=ready). */
  incMeetingReportGenerated(): void {
    this.meetingReportGeneratedTotal.inc();
  }

  /** Отчёт упал после ретраев. reason ∈ {llm_error, cost_limit, other}. */
  incMeetingReportFailed(args: { reason: 'llm_error' | 'cost_limit' | 'other' }): void {
    this.meetingReportFailedTotal.inc({ reason: args.reason });
  }

  /** Регенерация существующего отчёта. */
  incMeetingReportRegenerated(): void {
    this.meetingReportRegeneratedTotal.inc();
  }

  /** Soft-удаление отчёта. */
  incMeetingReportDeleted(): void {
    this.meetingReportDeletedTotal.inc();
  }

  /** Длительность job custom-report в секундах. */
  observeMeetingReportDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.meetingReportDurationSeconds.observe(seconds);
  }

  /** Оценочная стоимость LLM-вызова custom-report (USD). */
  incMeetingReportLlmCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.meetingReportLlmCostUsd.inc(usd);
  }

  // ────────────────────── conversational (SBA α-1) ────────────────────

  /**
   * Событие жизненного цикла notification: queued / sent_partial / delivered /
   * read / responded / failed. Каждый переход — отдельный счётчик.
   */
  incConversationalNotification(args: { eventType: string; status: string }): void {
    this.conversationalNotificationsTotal.inc({
      event_type: args.eventType,
      status: args.status,
    });
  }

  /** Попытка доставки в один канал. status — `queued`/`sent`/`delivered`/`failed` и т.д. */
  incConversationalDelivery(args: { kind: string; status: string }): void {
    this.conversationalDeliveriesTotal.inc({
      kind: args.kind,
      status: args.status,
    });
  }

  /** Inbound-сообщение (free_note/response/chat_query) из канала. */
  incConversationalInbound(args: { kind: string; type: string }): void {
    this.conversationalInboundTotal.inc({
      kind: args.kind,
      type: args.type,
    });
  }

  /** Попытка привязки канала: generated / verified / invalid_code. */
  incConversationalLinkAttempt(args: { kind: string; status: string }): void {
    this.conversationalLinkAttemptsTotal.inc({
      kind: args.kind,
      status: args.status,
    });
  }

  /** Время ответа пользователя на probe-нотификацию. */
  observeConversationalResponseTime(args: {
    kind: string;
    eventType: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.conversationalResponseTimeSeconds.observe(
      { kind: args.kind, event_type: args.eventType },
      args.seconds,
    );
  }

  // ────────────────────── telegram bot (SBA β-1) ─────────────────────

  /** Ошибка вызова Telegram Bot API (network error / non-ok response). */
  incTelegramBotApiError(args: { apiMethod: string; code: string }): void {
    this.telegramBotApiErrorsTotal.inc({
      api_method: args.apiMethod,
      code: args.code,
    });
  }

  /** Принят webhook Update от Telegram. type ∈ {message, callback_query, command, edited_message, ignored, unknown}. */
  incTelegramBotWebhookReceived(args: { type: string }): void {
    this.telegramBotWebhookReceivedTotal.inc({ type: args.type });
  }

  // ────────────────────── max bot (SBA β-1) ──────────────────────────

  /** Ошибка вызова MAX Bot API. */
  incMaxBotApiError(args: { apiMethod: string; code: string }): void {
    this.maxBotApiErrorsTotal.inc({
      api_method: args.apiMethod,
      code: args.code,
    });
  }

  /** Принят webhook update от MAX. type ∈ {message_created, message_callback, bot_started, ignored, unknown}. */
  incMaxBotWebhookReceived(args: { type: string }): void {
    this.maxBotWebhookReceivedTotal.inc({ type: args.type });
  }

  // ────────────────────── core router (SBA α-3) ──────────────────────

  /** Один блок диспатчился в одного специалиста — счётчик инкрементируется. */
  incCoreRouterDispatched(args: { specialist: string; signalType: string }): void {
    this.coreRouterDispatchedTotal.inc({
      specialist: args.specialist,
      signal_type: args.signalType,
    });
  }

  /** Распределение fan-out (сколько специалистов на блок до trimming'а). */
  observeCoreRouterFanOut(count: number): void {
    if (count < 0) return;
    this.coreRouterFanOut.observe(count);
  }

  /** Сработал лимит `ROUTER_MAX_SPECIALISTS_PER_BLOCK` — часть отброшена. */
  incCoreRouterTrimmed(args: { signalType: string }): void {
    this.coreRouterTrimmedTotal.inc({ signal_type: args.signalType });
  }

  // ────────────────────── curation (SBA α-4) ───────────────────────

  /** Инкремент при создании / переходе CurationItem по статусу. */
  incCurationItem(args: {
    resourceType: string;
    level: string;
    status: string;
  }): void {
    this.curationItemsTotal.inc({
      resource_type: args.resourceType,
      level: args.level,
      status: args.status,
    });
  }

  /** Инкремент при принятии решения куратором. */
  incCurationDecision(args: { decisionType: string; level: string }): void {
    this.curationDecisionTotal.inc({
      decision_type: args.decisionType,
      level: args.level,
    });
  }

  /** Время с момента создания CurationItem до принятия решения. */
  observeCurationTimeToDecide(args: { level: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.curationTimeToDecideSeconds.observe({ level: args.level }, args.seconds);
  }

  /** Auto-canonical через triage (минуя CurationItem). */
  incCurationAutoCanonical(args: { resourceType: string }): void {
    this.curationAutoCanonicalTotal.inc({ resource_type: args.resourceType });
  }

  /**
   * Конфликты — создание (resolution='created') или резолюция
   * (resolution='accept_new'|'keep_old'|'merge'|'evolving'|'dismissed').
   */
  incCurationConflict(args: { relationType: string; resolution: string }): void {
    this.curationConflictsTotal.inc({
      relation_type: args.relationType,
      resolution: args.resolution,
    });
  }

  /** Карточка-кандидат на stale (probe владельцу). */
  incCurationStale(args: { resourceType: string }): void {
    this.curationStaleDetectedTotal.inc({ resource_type: args.resourceType });
  }

  // ────────────────────── specialists (SBA α-6) ────────────────────────

  /**
   * SBA α-6 — установка количества карточек специалиста по статусу.
   * Gauge (а не Counter), потому что замеряется текущее состояние, а не поток.
   * Обычно зовётся периодически из snapshot-cron'а на стороне каждого специалиста.
   */
  setCoreSpecialistCards(args: {
    type: string;
    status: string;
    value: number;
  }): void {
    this.coreSpecialistCardsTotal.set(
      { type: args.type, status: args.status },
      Math.max(0, args.value),
    );
  }

  /**
   * Инкремент gauge: используется специалистом, когда нет smart-snapshot'а
   * и проще пометить «+1 pending» / «+1 canonical» в момент перехода статуса.
   * NB: для долгосрочной правильности предпочтительнее `setCoreSpecialistCards`.
   */
  incCoreSpecialistCards(args: { type: string; status: string }): void {
    this.coreSpecialistCardsTotal.inc({ type: args.type, status: args.status });
  }

  /** Длительность полного цикла специалиста (job start → результат). */
  observeCoreSpecialistPipelineDuration(args: {
    type: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.coreSpecialistPipelineDurationSeconds.observe(
      { type: args.type },
      args.seconds,
    );
  }

  /** Прирост токенов, потраченных специалистом на LLM-вызов. */
  incCoreSpecialistLlmTokens(args: {
    type: string;
    model: string;
    tier: string;
    tokens: number;
  }): void {
    if (args.tokens <= 0) return;
    this.coreSpecialistLlmTokensTotal.inc(
      { type: args.type, model: args.model, tier: args.tier },
      args.tokens,
    );
  }

  /** Специалист отправил probe-event (через ConversationalService/ProbeService). */
  incCoreSpecialistProbeEvent(args: { type: string; reason: string }): void {
    this.coreSpecialistProbeEventsTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  /** Специалист зарепортил conflict через ConflictService.report. */
  incCoreSpecialistConflictEvent(args: { type: string }): void {
    this.coreSpecialistConflictEventsTotal.inc({ type: args.type });
  }

  /** SBA α-7 — провал LLM-extraction (LLM упала, JSON битый, схема не прошла, и т.п.). */
  incCoreSpecialistExtractionFailure(args: {
    type: string;
    reason: string;
  }): void {
    this.coreSpecialistExtractionFailuresTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  /** SBA β-3 — evolving-конфликт (специалист 3.3 нашёл supersede-связку). */
  incCoreSpecialistConflictEvolving(args: { type: string }): void {
    this.coreSpecialistConflictEvolvingTotal.inc({ type: args.type });
  }

  /** SBA β-3 — длина supersede-цепочки Decision (для аналитики). */
  observeDecisionSupersedeChainLength(length: number): void {
    if (length < 0) return;
    this.decisionSupersedeChainLength.observe(length);
  }

  /** SBA β-2 — наблюдение по числу категорий в построенном knowledgeProfile. */
  observeKnowledgeCloneCategoriesPerProfile(count: number): void {
    if (count < 0) return;
    this.knowledgeCloneCategoriesPerProfile.observe(count);
  }

  /** SBA β-2 — наблюдение по размеру сериализованного knowledgeProfile в KB. */
  observeKnowledgeCloneProfileSizeKb(kb: number): void {
    if (kb < 0) return;
    this.knowledgeCloneProfileSizeKb.observe(kb);
  }

  /**
   * SBA β-4 — выставить gauge числа Insight'ов в каждом dynamicLabel-сегменте.
   * Вызывается из `InsightClustererCron` после пересчёта частот.
   */
  setInsightsDynamicLabelCount(args: {
    label: 'growing' | 'stable' | 'declining' | 'spike';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.insightsDynamicLabelCount.set({ label: args.label }, args.value);
  }

  // ────────────────────── probe-agent + ideas (SBA β-5) ────────────────

  /** Создан probe-event (status: pending | dropped_* | dispatched). */
  incProbeEvent(args: {
    emittedByService: string;
    reason: string;
    status: string;
  }): void {
    this.probeEventsTotal.inc({
      emitted_by_service: args.emittedByService,
      reason: args.reason,
      status: args.status,
    });
  }

  /** Probe доставлен в конкретный канал (kind = ChannelKind). */
  incProbeDispatched(args: { kind: string }): void {
    this.probeDispatchedTotal.inc({ kind: args.kind });
  }

  /** Пользователь ответил на probe (event_type × kind). */
  incProbeResponse(args: { eventType: string; kind: string }): void {
    this.probeResponseTotal.inc({
      event_type: args.eventType,
      kind: args.kind,
    });
  }

  /** Время от dispatch до ответа (event_type × kind), секунды. */
  observeProbeResponseTime(args: {
    eventType: string;
    kind: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.probeResponseTimeSeconds.observe(
      { event_type: args.eventType, kind: args.kind },
      args.seconds,
    );
  }

  /** Probe отброшен по дедупу (reason — машинно-читаемый код причины). */
  incProbeDedupDropped(args: { reason: string }): void {
    this.probeDedupDroppedTotal.inc({ reason: args.reason });
  }

  /** Probe отброшен по rate-limit'у получателей. */
  incProbeRateLimitDropped(): void {
    this.probeRateLimitDroppedTotal.inc();
  }

  /** Probe отложен по cold-start mode. */
  incProbeColdStartDropped(): void {
    this.probeColdStartDroppedTotal.inc();
  }

  /** Probe истёк без ответа. */
  incProbeExpired(): void {
    this.probeExpiredTotal.inc();
  }

  /** Установить engagement rate для пользователя (cron-обновляемый gauge). */
  setProbeRecipientEngagementRate(args: {
    userId: string;
    rate: number;
  }): void {
    if (args.rate < 0) return;
    this.probeRecipientEngagementRate.set(
      { user_id: args.userId },
      args.rate,
    );
  }

  /** Отправлено уведомление supporter'у о смене статуса идеи. */
  incIdeaStatusChangeNotification(args: { newStatus: string }): void {
    this.ideaStatusChangeNotificationsTotal.inc({ new_status: args.newStatus });
  }

  // ────────────────────── chat-v2 (SBA α-5) ────────────────────────────

  incChatV2Query(args: { mode: string; channelOrigin: string }): void {
    this.chatV2QueriesTotal.inc({
      mode: args.mode,
      channel_origin: args.channelOrigin,
    });
  }

  observeChatV2RetrievalBlocks(args: { mode: string; count: number }): void {
    this.chatV2RetrievalBlocks.observe({ mode: args.mode }, args.count);
  }

  observeChatV2SynthesisDuration(args: {
    mode: string;
    seconds: number;
  }): void {
    this.chatV2SynthesisDurationSeconds.observe(
      { mode: args.mode },
      args.seconds,
    );
  }

  incChatV2NoEvidence(args: { mode: string }): void {
    this.chatV2NoEvidenceTotal.inc({ mode: args.mode });
  }

  incChatV2UncertaintyMarked(args: { mode: string }): void {
    this.chatV2UncertaintyMarkedTotal.inc({ mode: args.mode });
  }

  incChatV2ConversationArchived(args: { reason: string }): void {
    this.chatV2ConversationsArchivedTotal.inc({ reason: args.reason });
  }

  // ────────────────────── SBA γ-1 (Skill + Persona + Clone) ────────────

  /** SBA γ-1 — установить gauge активных SkillProfile. */
  setSkillProfilesActiveTotal(count: number): void {
    if (count < 0) return;
    this.skillProfilesActiveTotal.set(count);
  }

  /** SBA γ-1 — наблюдение по числу активных traits в одном профиле. */
  observeSkillTraitsPerProfile(count: number): void {
    if (count < 0) return;
    this.skillTraitsPerProfile.observe(count);
  }

  /** SBA γ-1 — counter mark_as_misleading (для тюна промпта). */
  incSkillTraitsMarkedMisleading(args: { category: string }): void {
    this.skillTraitsMarkedMisleadingTotal.inc({
      category: args.category.slice(0, 200),
    });
  }

  /** SBA γ-1 — gauge активных ExecutablePersona по scope. */
  setPersonaActiveTotal(args: { scope: 'person' | 'role'; value: number }): void {
    if (args.value < 0) return;
    this.personaActiveTotal.set({ scope: args.scope }, args.value);
  }

  /** SBA γ-1 — длительность сборки одной ExecutablePersona. */
  observePersonaBuildDuration(seconds: number): void {
    if (seconds < 0) return;
    this.personaBuildDurationSeconds.observe(seconds);
  }

  /** SBA γ-1 — counter вызовов Clone API. */
  incCloneAsk(args: { scope: 'person' | 'role' }): void {
    this.cloneAskTotal.inc({ scope: args.scope });
  }

  /** SBA γ-1 — counter вызовов клона носителем (engagement). */
  incCloneAskByOwner(): void {
    this.cloneAskByOwnerTotal.inc();
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

  private getOrCreateGauge<L extends string>(config: {
    name: string;
    help: string;
    labelNames?: readonly L[];
  }): Gauge<L> {
    const existing = register.getSingleMetric(config.name);
    if (existing instanceof Gauge) {
      return existing as Gauge<L>;
    }
    return new Gauge<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames as L[] | undefined) ?? [],
    });
  }
}
