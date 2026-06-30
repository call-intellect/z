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
  private recordingTrackEgressFailedTotal!: Counter<'reason'>;
  private recordingTrackWatchdogTotal!: Counter<'outcome'>;

  // ── integrations ────────────────────────────────────────────────────
  private crossmarkApiRequestsTotal!: Counter<'endpoint' | 'status'>;
  private livekitWebhookEventsTotal!: Counter<'type'>;
  private livekitEgressEndedGapSeconds!: Histogram<'request_type'>;

  // ── llm fallback ────────────────────────────────────────────────────
  private llmFallbackTotal!: Counter<'provider'>;

  // ── llm router (per-task routing) ───────────────────────────────────
  private llmRouterDispatchTotal!: Counter<'task_type' | 'provider' | 'status'>;

  // ── llm router fallback exhausted (Фаза A.4) ────────────────────────
  private coreLlmNoProviderTotal!: Counter<'task_type'>;

  // ── llm cost unpriced (модель без цены → costUsd молча = 0) ──────────
  private llmCostUnpricedTotal!: Counter<'provider' | 'model'>;

  // ── block-linker fallback на none (молчаливая деградация графа) ──────
  private kcBlockLinkerFallbackNoneTotal!: Counter<'reason'>;
  private kcBlockLinkerInvalidJsonTotal!: Counter<'reason'>;

  // ── entity-graph fallback на none (молчаливая деградация графа) ──────
  private kcEntityGraphInvalidJsonTotal!: Counter<'reason'>;
  private kcEntityGraphFallbackNoneTotal!: Counter<'reason'>;

  // ── семантический дедуп задач встречи (Ф5 Р2) ────────────────────────
  private taskDedupeTotal!: Counter<'result'>;

  // ── дедуп-гейт прямого create (TZ task-dedup, WP-J) ──────────────────
  private taskDedupSuggestedTotal!: Counter<'tenant_top'>;

  private morningTasksDigestTotal!: Counter<'is_empty'>;

  // ── петля закрытия задачи (TZ task-loop Ф2b) ─────────────────────────
  private taskClosureOutcomeTotal!: Counter<'outcome'>;

  // ── ChatBox синк/анализ (ТЗ 2026-06-11 remaining-handoff Ф3) ──────────
  // syncs — успех/провал синка per scope; analyzes — успех/провал анализа
  // сессии; pending — сколько закрытых сессий ждут анализа (gauge);
  // last_sync_ts — unixtime последнего успешного синка per scope (для алёрта
  // «синк отстал»).
  private chatboxSyncsTotal!: Counter<'scope' | 'status'>;
  private chatboxAnalyzesTotal!: Counter<'status'>;
  private chatboxTasksOwnerMissingTotal!: Counter<string>;
  private chatboxPendingSessions!: Gauge<string>;
  private chatboxStuckAnalyzing!: Gauge<string>;
  private chatboxLastSyncTsSeconds!: Gauge<'scope'>;

  // ── llm prompt caching (T7-F3 prompt caching distribution) ───────────
  // Все 3 счётчика инкрементируются из AiUsageLogService.record() — там
  // одна точка для router-вызовов и для LlmFallbackService-вызовов.
  // hit = успешный вызов с cache_read > 0 (cardinality безопасна:
  // provider × model ≈ 50-100 рядов).
  private llmCacheHitTotal!: Counter<'provider' | 'model' | 'task_type'>;
  private llmCacheReadTokensTotal!: Counter<'provider' | 'model'>;
  private llmCacheCreationTokensTotal!: Counter<'provider' | 'model'>;
  // Ф6 Часть 3 — знаменатель hit-ratio: общее число успешных LLM-вызовов
  // per provider. Инкрементируется в той же точке (AiUsageLogService.record),
  // где фиксируется cache_hit. ratio = cache_hit / calls по тем же провайдерам.
  private llmCallsTotal!: Counter<'provider'>;
  // Ф6 Часть 3 — gauge-флаг: smoke-cron выставляет 1, если доля cache-хитов
  // по провайдеру ниже порога, иначе 0. Для алёртов в Grafana.
  private llmCacheHitRatioBelowThreshold!: Gauge<'provider'>;

  // ── deepseek schema→tool conversion (ТЗ 2026-05-25) ─────────────────
  // DeepSeek-V4-Pro в thinking-режиме не поддерживает strict json_schema —
  // DeepSeekService автоматически конвертирует его в эквивалентный tool
  // + tool_choice='auto'. Большое значение этой метрики — индикатор того,
  // что много caller-ов всё ещё передают json_schema, имеет смысл задуматься
  // о массовом переходе на tools.
  private deepseekSchemaToToolConversionTotal!: Counter<'model'>;

  // ── llm thinking-model guard (ТЗ 2026-05-25 Фаза 1) ──────────────────
  // Универсальный счётчик автоматических подмен параметров для thinking-моделей
  // (DeepSeek-V4-Pro / любые «*-pro» / «*-thinking»). kind ∈ schema-to-tool
  // | strict-stripped | tool-choice-relaxed. Покрывает и `DeepSeekService`,
  // и `OpenAiChatProtocolAdapter` (registry-путь). Высокое значение
  // strict-stripped — caller-ы передают одновременно tools И json_schema:
  // надо убирать json_schema на их стороне.
  private llmThinkingModelGuardTotal!: Counter<'kind' | 'model'>;

  // ── admin ai-models (Фаза A.4) ──────────────────────────────────────
  private adminAiModelsRouteChangeTotal!: Counter<'task_type' | 'change_type'>;
  private adminAiModelsExperimentStartedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentStoppedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentCompletedTotal!: Counter<'task_type'>;

  // ── prompt resolver (Фаза A.1) ──────────────────────────────────────
  private promptResolverTotal!: Counter<'source'>;
  private promptResolverFallbackTotal!: Counter<'reason'>;

  // ── prompt injection guard (ТЗ 2026-05-24 §4) ──────────────────────
  // source ∈ custom_prompt | transcript | chat (откуда пришёл подозрительный текст).
  // pattern — стабильный id regex'а из sanitize-custom-prompt.FORBIDDEN_PATTERNS.
  private promptInjectionAttemptTotal!: Counter<'source' | 'pattern'>;

  // ── prompt invalid response (ТЗ 2026-05-24 §9 F6 — tool_use / json_schema) ──
  // task_type — taskType из LlmRouter (chapters / tasks / dialog-classify / ...).
  // model — фактическая модель, ответившая невалидным JSON'ом.
  // reason ∈ json_parse | schema | tool_missing.
  //   - json_parse — JSON.parse упал.
  //   - schema     — JSON распарсился, но не прошёл Zod-валидацию.
  //   - tool_missing — caller просил json_schema через tool_use, но провайдер
  //                    вернул text вместо tool_use (Anthropic игнорирует
  //                    tool_choice в редких случаях).
  private promptInvalidResponseTotal!: Counter<'task_type' | 'model' | 'reason'>;

  // ── Query Understanding Волна 1 (ТЗ 2026-06-10 query-understanding-tier0-tier1) ──
  private queryPlanExtractionTotal!: Counter<'result'>;
  private queryPlanRetrievalFilteredTotal!: Counter<'filtered'>;
  private queryPlanEmptyPoolTotal!: Counter<'result'>;
  private routerQueryClassTotal!: Counter<'class'>;
  private routerBothWaysTotal!: Counter<'triggered'>;

  // ── task assignee resolver (ТЗ 2026-05-25 hard-participant-identification) ─
  // Инкрементируется в `TaskAssigneeResolverService`, когда участников с
  // одинаковым display name >1 (или LLM вернул userId не из списка
  // participants — галлюцинация). В обоих случаях `assigneeUserId` сбрасывается
  // в null и Task сохраняется только с `assigneeRaw`.
  // tenant — Org.id; reason ∈ 'duplicate_name' | 'llm_hallucination'.
  private taskAssigneeAmbiguousTotal!: Counter<'tenant' | 'reason'>;

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
  /**
   * KC-Temporal W1.1 (2026-05-25) — gauge «открытых» (validUntil IS NULL)
   * IdeaBlock'ов, разрезанных по `signal_type`. Снапшотится тем же кроном
   * `CoreMetricsSnapshotCron`.
   */
  private kcFactsOpenGauge!: Gauge<'tenant' | 'signal_type'>;
  private corePipelineDurationSeconds!: Histogram<'worker'>;
  private coreLlmTokensTotal!: Counter<'tenant' | 'task_type'>;
  private coreRetentionDeletedTotal!: Counter<'kind'>;
  private corePersonalDataErasuresTotal!: Counter<string>;
  private coreDataClassViolationsTotal!: Counter<'task_type' | 'attempted_class'>;
  private llmBudgetExceededTotal!: Counter<'mode'>;

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

  // ── meeting report fast (ТЗ 2026-05-25) ───────────────────────────
  // Один LLM-вызов поверх сырого транскрипта (chapters + tasks + summary +
  // quality score). См. plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md.
  // tenant — Org.id (low cardinality в рамках инсталляции).
  // status — 'ready'|'failed'|'partial'.
  private meetingReportFastTotal!: Counter<'tenant' | 'status'>;
  private meetingReportFastDurationSeconds!: Histogram<string>;

  // ── conversational channels (SBA α-1) ─────────────────────────────
  private conversationalNotificationsTotal!: Counter<'event_type' | 'status'>;
  private conversationalDeliveriesTotal!: Counter<'kind' | 'status'>;
  private conversationalInboundTotal!: Counter<'kind' | 'type'>;
  private conversationalLinkAttemptsTotal!: Counter<'kind' | 'status'>;
  private conversationalResponseTimeSeconds!: Histogram<'kind' | 'event_type'>;

  // ── TZ-1 Фаза 0 (daily-value-engine) — дневной бюджет + кампания привязки ──
  private notificationBudgetConsumedTotal!: Counter<'trigger'>;
  private notificationBudgetBlockedTotal!: Counter<'reason'>;
  private notificationDeferredToDigestTotal!: Counter<string>;
  private channelBindingCoverageRatio!: Gauge<'tenant_top'>;
  private channelBindingCampaignInvitedTotal!: Counter<'tenant_top'>;
  private checkinPromptDeliveredTotal!: Counter<'channel'>;

  // ── ТЗ checkin-day-report-from-graph (Ф2/Ф3/Ф4) — сборщик дневных отчётов из графа ──
  private dayReportCollectedTotal!: Counter<'tenant_top'>;
  private dayReportBlockDroppedNoPersonTotal!: Counter<string>;
  private dayReportNotDoneVerifyCallsTotal!: Counter<string>;

  // ── TZ-1 Фаза 1 (daily-value-engine) — радар клиентов под риском ──
  private customerRiskSnapshotsTotal!: Counter<'level'>;
  private customerRiskRadarFailedTotal!: Counter<'reason'>;
  private customerRiskManagerNotifiedTotal!: Counter<string>;

  // ── ТЗ-2 Ф6.A (daily-value-dashboards) — здоровье портфеля целей ──
  private portfolioHealthScore!: Gauge<'tenant_top'>;
  private portfolioHealthSnapshotTotal!: Counter<'tenant_top'>;
  private portfolioPrioritySetTotal!: Counter<'tenant_top' | 'priority'>;

  // ── TZ-1 Фаза 2 (daily-value-engine) — движок рядового «Твой день» ──
  private personalDailyBriefBuiltTotal!: Counter<string>;
  private personalDailyBriefDeliveredTotal!: Counter<'channel'>;
  private personalDailyBriefOpenedTotal!: Counter<string>;
  private knowsWhoMatchTotal!: Counter<'found'>;
  // ── B6/Ф7 (mobile-cora-exec-manager §Ф7) — утренний exec web-push ──
  private execMorningPushDeliveredTotal!: Counter<'channel'>;

  private blockerSynthesisRecurringTotal!: Counter<'status'>;
  private taskClosureReopenRate!: Gauge<'tenant_top'>;
  private promiseCascadeAlertTotal!: Counter<string>;
  private themeSilenceSurfacedTotal!: Counter<'severity'>;

  // ── TZ-1 Фаза 4 (daily-value-engine) — улучшения и знания ──
  private ideasTopServedTotal!: Counter<string>;
  private ideaStatusAutoAdvancedTotal!: Counter<'to'>;
  private ideaStatusChangedNotifiedTotal!: Counter<string>;
  private insightRecheckedTotal!: Counter<'reactivated'>;
  private knowledgeAtRiskTotal!: Counter<'severity'>;
  private teamCapacityOverloadTotal!: Counter<string>;
  private onboardingRampStalledTotal!: Counter<string>;

  // ── TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap ──
  private valueRecapBuiltTotal!: Counter<string>;
  private valueRecapDeliveredTotal!: Counter<'channel'>;
  private valueRecapOpenedTotal!: Counter<string>;
  private chatV2FeedbackTotal!: Counter<'reaction'>;
  private chatV2AnsweredWithCitation!: Gauge<'mode'>;

  // ── telegram bot channel (SBA β-1) ────────────────────────────────
  private telegramBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private telegramBotWebhookReceivedTotal!: Counter<'type'>;

  // ── telegram proxy (2026-05-26) — транспорт через telegram.crossmark.ru ─
  // Различают «трансферный сбой между нами и прокси» vs «Telegram через
  // прокси вернул ошибку». См. plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §1.1 п.6.
  private telegramProxyRequestTotal!: Counter<'api_method' | 'outcome'>;
  private telegramProxyRequestDurationSeconds!: Histogram<'api_method'>;
  private telegramProxyHealthCheckTotal!: Counter<'outcome'>;

  // ── telegram bot — глобальный канал (β-9, 2026-05-25) ─────────────
  // Отдельные счётчики, чтобы при переходе с per-tenant на глобальный
  // путь видеть распределение трафика и количество писем от незнакомых
  // отправителей (linked, но без Membership / вовсе незнакомых).
  private telegramBotGlobalWebhookReceivedTotal!: Counter<'type'>;
  private telegramBotUnknownSenderTotal!: Counter<'reason'>;
  /**
   * β-9 / Phase 6 — команда `/login` в Telegram-боте (выпуск magic-link
   * прямо в чат боту). outcome ∈ ok | not_linked | user_not_found.
   */
  private botLoginCommandTotal!: Counter<'outcome'>;

  // ── admin: действия в админке Z над глобальным Telegram-ботом (β-9) ─
  // action ∈ token_changed | webhook_reset | status_toggled |
  //          templates_updated | settings_read | bindings_read.
  private adminTelegramBotActionsTotal!: Counter<'action'>;

  // ── invitations + magic-link (β-9, 2026-05-25) ─────────────────────
  // Сопровождают GitHub-style flow приглашений: создание/принятие,
  // напоминания, истечения, magic-link request/consume.
  // has_email: true|false (приглашение с указанной электронной почтой
  // или без).
  // path: magic_link | password | telegram_first.
  // day: 7 | 14.
  // outcome (request): sent | rate_limited | user_not_found.
  // outcome (consume): ok | expired | already_used | invalid.
  private inviteCreatedTotal!: Counter<'has_email'>;
  private inviteAcceptedTotal!: Counter<'path'>;
  private inviteReminderSentTotal!: Counter<'day'>;
  private inviteExpiredTotal!: Counter<string>;
  private magicLinkRequestTotal!: Counter<'outcome'>;
  private magicLinkConsumeTotal!: Counter<'outcome'>;
  // audit Б2 (2026-05-29) — глобальный MustChangePasswordGuard заблокировал
  // запрос пользователя с mustChangePassword=true вне whitelist'а.
  private mustChangePasswordBlockTotal!: Counter<'path'>;
  // audit Б4 (2026-05-29) — webhook от Точки отвергнут на этапе verify.
  // reason ∈ expired | not_before | signature | missing_iat | other.
  private tochkaWebhookReplayTotal!: Counter<'reason'>;
  // audit Б6 (2026-05-29) — self-referral / INN-mismatch на верификации.
  private referralSelfReferralDeniedTotal!: Counter<string>;
  private referralInnMismatchTotal!: Counter<'reason'>;
  // commercial-reliability pack (2026-05-30) — повторный клик по реф-ссылке
  // отброшен first-touch гардом (AttributionService.attributeOrg). Считаем
  // только реальные блокировки last-touch попыток.
  private referralAttributionFirstTouchLockedTotal!: Counter<string>;
  // commercial-reliability pack (2026-05-30, Фаза 3) — хост переименовал гостя
  // встречи (Zoom-модель: гость представился именем при входе, хост может
  // поправить после встречи).
  private participantRenamedTotal!: Counter<string>;
  // commercial-reliability pack (2026-05-30, Фаза 4) — биллинг / Точка.
  // tenant_top через tenantTopOf, чтобы cardinality оставался ≤ 100×3.
  private billingInvoiceCreatedTotal!: Counter<'tenant_top' | 'kind'>;
  private billingInvoicePaidTotal!: Counter<'tenant_top' | 'kind'>;
  private billingSubscriptionRenewedTotal!: Counter<'tenant_top' | 'tier'>;
  private billingSubscriptionCancelledTotal!: Counter<'tenant_top' | 'reason'>;
  private billingWebhookReceivedTotal!: Counter<'provider' | 'status'>;
  private billingProviderRequestDurationSeconds!: Histogram<
    'provider' | 'method' | 'status'
  >;
  // commercial-reliability pack (2026-05-30, Фаза 4) — реферальная воронка.
  // partner_top через tenantTopOf(slug).
  private referralClickTotal!: Counter<'partner_top'>;
  private referralSignupTotal!: Counter<'partner_top'>;
  private referralPayoutCreatedTotal!: Counter<'cron_run_date'>;
  private referralPayoutAmountRubTotal!: Counter<string>;
  // referrals-cabinet-revamp §8.3a (2026-05-31) — промо-полоса
  // `<ReferralPromoStrip />` в `AppShell`. Все три инкрементируются
  // через POST /api/v1/referrals/me/promo-event (throttle 30/min/IP).
  // Label role ∈ owner | member (две стабильные строки — cardinality 2).
  private referralPromoImpressionTotal!: Counter<'role'>;
  private referralPromoClickTotal!: Counter<'role'>;
  private referralPromoDismissedTotal!: Counter<'role'>;
  // audit С3 (2026-05-29) — safeEmit() в BillingService поймал ошибку
  // listener'а. Лейбл event = BillingEvent.* (см. billing.types.ts).
  private billingEmitFailedTotal!: Counter<'event'>;
  // audit С23 (2026-05-29) — concierge не смог прочитать cfg.concierge.*
  // (кэш TypedConfigService протух / hot-reload race). Не блокирует запрос,
  // но если значение > 0 в проде — нужно диагностировать конфиг.
  private conciergeConfigErrorTotal!: Counter<'reason'>;

  // ── max bot channel (SBA β-1) ─────────────────────────────────────
  private maxBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private maxBotWebhookReceivedTotal!: Counter<'type'>;

  // ── zero-button bot inbound (SBA β-1 rip-out, 2026-05-23) ─────────
  // Унифицированные метрики обоих ботов (telegram_bot + max_bot).
  // kind ∈ text | voice | document | start_command | link_code | other.
  private botInboundTotal!: Counter<'channel' | 'kind'>;
  private botVoiceAsrDurationSeconds!: Histogram<'channel'>;
  // source ∈ llm | heuristic. intent ∈ chat_query | free_note.
  private botIntentClassifiedTotal!: Counter<'channel' | 'intent' | 'source'>;
  // ТЗ 2026-05-29 telegram-self-initiated-checkins — распознавание
  // plan/report в bot-адаптере. source ∈ llm | fallback_heuristic |
  // fallback_factual_at_llm_fail. kind ∈ morning | evening.
  private botCheckinIntentClassifierTotal!: Counter<
    'channel' | 'kind' | 'source'
  >;
  // ТЗ 2026-05-29 telegram-self-initiated-checkins — outcome обработки
  // self-initiated daily_checkin_self в CheckinResponseHandler.processSelfInitiated.
  // outcome ∈ saved | low_parser_confidence_curator_review | no_person |
  // no_membership | error.
  private botDailyCheckinSelfTotal!: Counter<'channel' | 'kind' | 'outcome'>;

  // ── tracker Phase 4 РФ — Telegram-бот для задач (Wave 3, 2026-05-24) ──
  // tenant_top — top-100 буцет (хэш % 64) во избежание раздутия cardinality.
  // status ∈ created | auto_created | failed | intake_only.
  private telegramTasksCreatedTotal!: Counter<'tenant_top' | 'status'>;
  // kind ∈ create_task | forward_to_task.
  private telegramVoiceTranscribedTotal!: Counter<'tenant_top' | 'kind'>;
  private telegramForwardsTotal!: Counter<'tenant_top' | 'status'>;
  // result ∈ sent | empty | dedup_skip | error.
  private telegramDigestSentTotal!: Counter<'tenant_top' | 'result'>;
  // Reply-classify result: status_command | comment | new_task | unknown.
  private telegramReplyClassifiedTotal!: Counter<'tenant_top' | 'kind'>;
  // Action Center B3 — повторяющееся Telegram-напоминание о pending-подтверждениях.
  // result ∈ sent | empty | dedup | error.
  private pendingReminderSentTotal!: Counter<'tenant_top' | 'result'>;

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
  // ── Action Center B5 «оживление expiresAt» (2026-06-02) ──
  private curationItemExpiredTotal!: Counter<'resource_type'>;
  private curationItemAgeSeconds!: Histogram<'level'>;
  // ── Action Center A1 «лестница доверия» (2026-06-02) ──
  private curationProvisionalTotal!: Counter<'resource_type'>;
  private curationAuditSampleTotal!: Counter<'resource_type'>;
  private curationVerifierVerdictTotal!: Counter<'decision' | 'consensus_type'>;
  private curationGrayZoneJudgedTotal!: Counter<'outcome'>;
  // ── Autonomy W1 (2026-06-12) — Conflict-Arbiter (LLM-арбитр конфликтов) ──
  // `z_conflict_arbiter_total{verdict, outcome}` — исходы ночного арбитра
  // конфликтов знаний: verdict дебата × outcome ∈ auto_resolved|left_open|error.
  private conflictArbiterTotal!: Counter<'verdict' | 'outcome'>;
  // ── Action Center A2 «лестница доверия» (2026-06-02) — autotune + kill-switch ──
  private curationKillSwitchTotal!: Counter<'resource_type'>;
  private curationAutotuneAdjustmentTotal!: Counter<'resource_type' | 'direction'>;
  // ── curation wave 2 (SBA α-4 wave 2) — CompletenessSlot + ConsistencyChecker ──
  // Cardinality-safe: tenant НЕ выносим в label (паттерн остальных curation/probe-метрик).
  // Top-100 tenant-агрегации делает Grafana / Prometheus recording rule поверх БД.
  private completenessSlotsOpenTotal!: Gauge<'card_type'>;
  private completenessSlotsFilledTotal!: Counter<'card_type'>;
  private consistencyViolationsTotal!: Counter<'rule'>;
  private consistencyCheckerDurationSeconds!: Histogram<never>;

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
  private corePartialLossTotal!: Counter<'reason'>;
  private strategicAlignmentParseSkipTotal!: Counter<'reason'>;
  private rawEventRecoveryReenqueuedTotal!: Counter<string>;
  private rawEventRecoveryDeadLetteredTotal!: Counter<string>;
  private blockWithoutEvidenceTotal!: Counter<'reason'>;
  private riskEdgeTotal!: Counter<'relation' | 'outcome'>;
  private ragAbstainTotal!: Counter<'mode'>;
  // Ф3 МТЗ «разблокировка конвейера» (баг #18) — счётчик ранних skip-return'ов
  // хендлеров специалистов. До этого skip был неотличим от success (duration-
  // метрика в finally на ВСЕХ путях). reason: 'block_not_found' /
  // 'tenant_mismatch' / 'not_canonical' / 'signal_out_of_scope'.
  private coreSpecialistSkippedTotal!: Counter<'specialist' | 'reason'>;
  private regulationScopeRoleUnresolvedTotal!: Counter<'tenant'>;
  private regulationOwnerHintUnresolvedTotal!: Counter<'tenant'>;
  // МТЗ «разблокировка конвейера» Ф5 — провалы записи типизированной сущности
  // группы Б (Process/Regulation/Policy/Tool/Metric/Decision) в block-ingest.
  // reason: 'age_unavailable' (системный отказ графа — cypher не резолвится) /
  // 'validation_error' / 'idempotent_skip' (P2002 гонка concurrency — норма) /
  // 'other'. Раньше любой провал глушился warn'ом без метрики.
  private kcTypedEntityFailedTotal!: Counter<'type' | 'reason'>;
  // Ф1 (knowledge-access) — детерминированная subject-атрибуция автора знания
  // по источнику identity (via). Покрывает ВСЕ типы знания (не только reasoning).
  private kcSubjectAttributionTotal!: Counter<'via'>;
  // Ф4 (knowledge-access) — гейт доступа к знаниям. shadow: сколько блоков
  // было бы отфильтровано (сверка перед enforce); enforce: сколько исключено.
  private kcAccessShadowDiffTotal!: Counter<'surface'>;
  private kcAccessDeniedTotal!: Counter<'surface'>;
  // Agent-chain overhaul Фаза 0a (2026-06-07) — встречи, где блоки с signalType
  // (decision/idea) есть, а соответствующая запись (Decision/Idea) не
  // материализовалась. Эмитит cron graph-materialization-verify (type).
  private kcMaterializationGapTotal!: Counter<'type'>;
  // Agent-chain overhaul Фаза 4.2 (2026-06-07) — детерминированная авто-привязка
  // Goal↔Theme. method: 'provenance' (блоки-источники цели уже в теме) |
  // 'comention' (тема упоминает те же сущности). Эмитит GoalThemeLinkerService.
  private goalThemeAutolinkTotal!: Counter<'method'>;
  // Agent-chain overhaul Фаза 4.1 (2026-06-08) — LLM-привязка задач встречи к
  // AI-цели (goal-task-link, DEFAULT OFF). result: 'linked' (Issue.goalId
  // проставлен) | 'rejected' (арбитр develops=false / низкий confidence / уже
  // не null) | 'fallback' (арбитр провалился) | 'skipped' (резерв).
  private goalTaskLinkTotal!: Counter<'result'>;
  // Ф7 МТЗ «разблокировка конвейера» (баг #1/#8) — провалы моста
  // `ingestMeeting` (analyze.worker → MeetingIngestAdapter). Раньше .catch
  // глушил провал в resolved-null → встреча выглядела «зелёной», RawEvent не
  // создавался, в граф ничего не уходило. reason: 'source_inactive' /
  // 'no_merged_transcript' / 'without_tenant' / 'quota_exceeded' / 'other'.
  // Только reason в label (низкая кардинальность); tenantId/meetingId — в лог.
  private meetingIngestFailedTotal!: Counter<'reason'>;
  // SBA β-3 — evolving-конфликты (отдельный counter рядом с
  // core_specialist_conflict_events_total). Не сливаем в один counter, чтобы
  // не ломать обратную совместимость существующих label'ов.
  private coreSpecialistConflictEvolvingTotal!: Counter<'type'>;
  // SBA β-3 — гистограмма длин supersede-цепочек Decision (для аналитики
  // «как часто решения переписываются»).
  private decisionSupersedeChainLength!: Histogram<never>;

  // ── Goals OKR v2 Фаза 3 (2026-06-02) — авто-прогресс KR ──────────────
  // `goal_kr_autoprogress_total{source_kind,status}` — каждая попытка
  // авто-пересчёта currentValue одного GoalKeyResult cron'ом.
  //   source_kind ∈ manual | meeting_count | issue_rollup | metric_entity;
  //   status ∈ ok (значение изменилось, checkpoint записан) |
  //            unchanged (значение не изменилось — no-op) |
  //            skipped (manual / manualOverride / нет конфигурации) |
  //            error (исключение при расчёте).
  private goalKrAutoprogressTotal!: Counter<'source_kind' | 'status'>;

  // ── Goals OKR v2 Фаза 4 (2026-06-02) — еженедельный пульс целей ──────
  //   goals_pulse_generated_total{tenant_top} — успешно собранный пульс;
  //   goals_pulse_failed_total{tenant_top,reason} — провал (reason ∈
  //     llm_failed|notify_failed|exception);
  //   goals_pulse_delivered_total{tenant_top,channel} — доставка пульса.
  private goalsPulseGeneratedTotal!: Counter<'tenant_top'>;
  private goalsPulseFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private goalsPulseDeliveredTotal!: Counter<'tenant_top' | 'channel'>;

  // ── Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges ──────────────
  // `temporal_edges_invalidated_total{relationType}` — каждый раз когда
  // TemporalConflictService закрывает existing open-link новой противоречащей
  // связью (ставит validUntil=NOW). relationType — закрытого link'а.
  private temporalEdgesInvalidatedTotal!: Counter<'relationType'>;
  // `temporal_filter_hits_total{result}` — каждый раз когда retrieval-фильтр
  // bi-temporal edges принимает решение по конкретному edge. result:
  //   - 'passed' — edge прошёл фильтр (validFrom/validUntil совместимы с validAt);
  //   - 'filtered_out' — edge отсеян (не валиден на момент Х).
  private temporalFilterHitsTotal!: Counter<'result'>;
  // `edges_with_temporal_total{type}` — gauge: сколько edges с непустыми
  // bi-temporal полями. Снапшотится ежечасным cron'ом (TODO в следующей волне).
  // type ∈ block | entity.
  private edgesWithTemporalTotal!: Gauge<'type'>;

  // ── Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate ──────────────
  // `z_debate_judgments_total{task_type, decision, consensus_type}` —
  // финальный verdict одного debate-run'а. decision = строка verdict'а
  // (`new`/`merge`/`supersedes`/`split_uncertain`); consensus_type ∈
  // unanimous | majority | split.
  private debateJudgmentsTotal!: Counter<'task_type' | 'decision' | 'consensus_type'>;
  // `z_debate_cost_usd_total{tenant_top, task_type}` — суммарный USD-cost
  // всех debate-run'ов. tenant_top — стандартный top-100 bucket
  // (паттерн `tenantTopOf`). Cardinality-safe.
  private debateCostUsdTotal!: Counter<'tenant_top' | 'task_type'>;
  // `z_debate_round2_triggered_total{task_type}` — round 2 запущен при split-verdict'е.
  private debateRound2TriggeredTotal!: Counter<'task_type'>;
  // `z_debate_provider_disagreement_total{provider_a, provider_b, task_type}` —
  // пара провайдеров, которые НЕ согласились (разные verdict'ы) в round 1.
  // Помогает понять, какие модели чаще расходятся (выбор diversity-pair'а).
  private debateProviderDisagreementTotal!: Counter<
    'provider_a' | 'provider_b' | 'task_type'
  >;
  // `z_debate_fallback_to_single_total{reason}` — debate сорвался и Specialist
  // вернулся к одиночному арбитру. reason ∈ cost_cap | provider_unavailable.
  private debateFallbackToSingleTotal!: Counter<'reason'>;

  private voxOutcomeTotal!: Counter<'outcome'>;

  // ── KC-Temporal W1.2 (2026-05-25) — FactSupersedeService ──────────────
  // verdict ∈ unrelated | extends | contradicts | supersedes | skip_*.
  // skip_* — короткие замыкания до LLM-вызова (no_candidates, not_fact_signal,
  // race_lost). Дают нам видимость cost burn-rate и accuracy.
  private kcFactSupersedeVerdictsTotal!: Counter<'verdict'>;
  // Длительность полного processNewBlock (от загрузки блока до commit'а
  // transaction'а / no-op'а). Включает KNN + LLM + Prisma. Истинная стоимость
  // фичи на каждый блок.
  private kcFactSupersedeLatencyMs!: Histogram<never>;

  // ── KC-Temporal W1.5 (2026-05-25) — EntityResolutionService ingest-path ──
  // path ∈ exact | knn | create | cache_hit.
  // Используется DoD «cache hit rate ≥ 60%» (= cache_hit / total).
  private kcEntityResolvePathTotal!: Counter<'path'>;
  private kcEntityResolveLatencyMs!: Histogram<never>;

  // ── KC-Temporal W3.5 (2026-05-25) — ProjectionRebuilderService ─────
  // type ∈ decision | insight | idea | card | regulation | process | policy |
  //        skill_trait | process_template | experiment.
  // Считаем сколько rebuild-jobs реально enqueue'нулись (с учётом
  // дедупа BullMQ — повторный enqueue в окне debounce не инкрементит).
  private kcProjectionRebuildTotal!: Counter<'type'>;
  // Lag от события `idea_block.updated` до момента enqueue (best-effort:
  // полный lag «до завершения rebuild job'а» требует hook на complete
  // worker'ов специалистов — оставлено на отдельную задачу).
  private kcProjectionRebuildLagMs!: Histogram<never>;

  // ── SBA β-2 — Knowledge Clone (Specialist 3.2) — два специфичных метрик'а.
  private knowledgeCloneCategoriesPerProfile!: Histogram<never>;
  private knowledgeCloneProfileSizeKb!: Histogram<never>;

  // ── SBA α-7 wave 2 — ProcessTemplate detector + completeness ────────
  private processTemplatesTotal!: Gauge<'tenant_top' | 'status'>;
  private processTemplateCompletenessAvg!: Gauge<'tenant_top'>;
  private processDetectorExtractionsTotal!: Counter<'tenant_top' | 'result'>;
  private processTemplateExtractDurationSeconds!: Histogram<never>;

  // ── SBA γ-3 — Cross-Functional Process + Handoff Tracker ────────────
  private crossFunctionalProcessesTotal!: Gauge<'tenant_top'>;
  private crossFunctionalFrictionActiveTotal!: Gauge<
    'tenant_top' | 'severity'
  >;
  private crossFunctionalFrictionResolutionTimeSeconds!: Histogram<'tenant_top'>;

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
  private probeClosedTotal!: Counter<'tenant_top' | 'source'>;
  private probeRecipientEngagementRate!: Gauge<'user_id'>;
  // ── Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify ──
  private probeResponseClassifiedTotal!: Counter<'confidence_bucket'>;
  private probeResponseUnclearTotal!: Counter<'original_reason'>;
  // ── Probe Фаза 5 (2026-06-11) — исход probe (калибровка Фазы 2) ──
  private probeOutcomeTotal!: Counter<'outcome' | 'reason'>;
  // ── Probe-clarify Фаза 6 (2026-06-27) — диалоговое уточнение ──
  private probeDialogTransitionTotal!: Counter<'from' | 'to'>;
  private probeDialogOutcomeTotal!: Counter<'outcome'>;
  private probeDialogDegradedTotal!: Counter<'reason'>;
  // ── Probe Фаза 2 (2026-06-17) — LLM-судья качества формулировки вопроса ──
  private probeQualityJudgedTotal!: Counter<'verdict'>;
  // ── Probe Фаза 4 (2026-06-20) — LLM-гейт ценности probe-вопроса ──
  private probeValueGateTotal!: Counter<'verdict'>;
  private subjectMemoryRuleExtractedTotal!: Counter<'kind'>;
  private taskAssigneeClarifyTotal!: Counter<'outcome'>;
  private companySummaryCompileTotal!: Counter<'result'>;
  private routingSuggestionTotal!: Counter<'match_path'>;
  private routingSuggestionAcceptedTotal!: Counter<string>;
  private routingNoCandidateTotal!: Counter<string>;
  private taskSkillRoutingAssignedTotal!: Counter<'path'>;
  private companyCapsuleInjectedTotal!: Counter<'surface'>;
  private subjectMemoryProbeSuppressedTotal!: Counter<'reason'>;
  private subjectMemoryRuleActivatedTotal!: Counter<never>;
  private subjectMemoryRuleRolledBackTotal!: Counter<'cause'>;
  private subjectMemoryApplyTotal!: Counter<'status'>;
  private subjectMemoryPendingSweptTotal!: Counter<never>;
  // ── W2 autonomy (2026-06-12) — OwnerResolver («лестница владельца») ──
  private ownerResolutionTotal!: Counter<'outcome'>;
  // ── Ф5/Ф6 assistant-channels (2026-06-12) — мост «каналы → помощник» ──
  private assistantTurnTotal!: Counter<'outcome'>;
  // ── Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow) ──
  private promptFeedbackTotal!: Counter<'prompt_key' | 'has_edit'>;
  private autoruleExtractedTotal!: Counter<'prompt_key' | 'rule_type'>;
  private autoruleRulesTotal!: Gauge<'prompt_key' | 'status' | 'source'>;
  private autoruleOverriddenTotal!: Counter<'prompt_key'>;
  // ── Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow) ──
  private conciergePrmAgreementTotal!: Counter<'agreed'>;
  private conciergePrmLlmChoseRankTotal!: Counter<'rank'>;
  private conciergePrmCostUsdTotal!: Counter<'tenant_top'>;
  private conciergePrmScoreDistribution!: Histogram<'tool_name'>;
  // ── Agents v2 Фаза C1 (2026-05-30) — PracticeSkill (executable skills) ──
  private practiceSkillsTotal!: Gauge<'tenant_top' | 'scope' | 'status'>;
  private practiceSkillsExtractedTotal!: Counter<'scope'>;
  private practiceSkillsPromotedTotal!: Counter<never>;
  private practiceSkillsArchivedTotal!: Counter<never>;
  private practiceSkillsRunsTotal!: Counter<'status'>;
  private practiceSkillsCompositeVsBaseline!: Histogram<never>;
  private practiceSkillsRetrievalHitTotal!: Counter<'scope'>;
  // ── Agents v2 Фаза C2 (2026-05-30) — GEPA prompt evolution ──
  private gepaOptimizationsTotal!: Counter<'prompt_key' | 'status'>;
  private gepaCandidatesTotal!: Gauge<'prompt_key' | 'status'>;
  private gepaPromotedTotal!: Counter<'prompt_key'>;
  private gepaRejectedTotal!: Counter<'reason'>;
  private gepaAbActiveTotal!: Gauge<never>;
  private gepaCostUsdTotal!: Counter<'tenant_top'>;
  private gepaRollbackTotal!: Counter<'reason'>;
  private ideaStatusChangeNotificationsTotal!: Counter<'new_status'>;

  // ── chat-v2 (SBA α-5) ─────────────────────────────────────────────
  private chatV2QueriesTotal!: Counter<'mode' | 'channel_origin'>;
  private chatV2RetrievalBlocks!: Histogram<'mode'>;
  private chatV2SynthesisDurationSeconds!: Histogram<'mode'>;
  private chatV2NoEvidenceTotal!: Counter<'mode'>;
  private chatV2UncertaintyMarkedTotal!: Counter<'mode'>;
  private chatV2ConversationsArchivedTotal!: Counter<'reason'>;
  // KC-Temporal W3.2 (2026-05-25) — счётчик подмешанных reasoning chain'ов.
  private chatV2ReasoningChainsAttachedTotal!: Counter<'depth'>;
  // KC-Temporal W3.3 (2026-05-25) — гистограмма «сколько contradicting блоков
  // попало в контекст ответа Chat-v2».
  private chatV2ContradictingBlocksInContext!: Histogram<string>;

  // ── dialog-layer (SBA α-5 dialog-layer) ──────────────────────────
  private answerCacheHitTotal!: Counter<'tenant_top'>;
  private retrievalCacheHitTotal!: Counter<'tenant_top'>;
  private dialogProcessingDurationSeconds!: Histogram<'step'>;
  private conversationSummaryTotal!: Counter<'tenant_top'>;
  private dialogConfidenceLowTotal!: Counter<'tenant_top'>;

  // ── SBA γ-1 — SkillProfile + ExecutablePersona + Clone API ────────
  private skillProfilesActiveTotal!: Gauge<never>;
  private skillTraitsPerProfile!: Histogram<never>;
  private skillTraitsMarkedMisleadingTotal!: Counter<'category'>;
  private personaActiveTotal!: Gauge<'scope'>;
  private personaBuildDurationSeconds!: Histogram<never>;
  private cloneAskTotal!: Counter<'scope'>;
  private cloneAskByOwnerTotal!: Counter<never>;
  // Фаза 1 clone-reliability-hardening — программный отказ клона отвечать.
  private cloneAskRefusedTotal!: Counter<'reason'>;
  // ── SBA γ-1 доделки — SkillTraitCategory + hybrid versioning ──
  private skillCategoriesTotal!: Gauge<'tenant_top'>;
  private skillTraitCategorizedRatio!: Gauge<'tenant_top'>;
  private executablePersonaSnapshotsTotal!: Counter<'tenant_top' | 'trigger'>;
  private executablePersonaSnapshotLagSeconds!: Gauge<'tenant_top'>;
  // ── clone-reliability-hardening Фаза 5 — реактивная пересборка персоны ──
  private personaRebuildTriggeredTotal!: Counter<'reason'>;
  // ── clone-reliability-hardening Фаза 2 — Смысловые блоки навыка ──
  private skillTraitConceptsTotal!: Gauge<'status'>;
  private skillTraitConceptsMergedTotal!: Counter<never>;
  // ── Clones=Roles Ф2 (2026-05-25) — версионирование клонов ролей ──
  private cloneRoleVersionCreatedTotal!: Counter<'role_id'>;
  private cloneRoleVersionsTotal!: Gauge<'role_id'>;
  // ── TZ clone-method Э1.2 (2026-06-12) — Reflection-слой принципов роли ──
  private rolePrinciplesSynthesizedTotal!: Counter<'outcome'>;
  private rolePrinciplesActiveTotal!: Gauge<never>;
  // ── TZ clone-method ВАЛ.1 (2026-06-12) — поведенческая валидация persona v1-vs-v2 ──
  private clonePersonaLayerScore!: Histogram<'variant'>;
  private personaLayerValidationCasesTotal!: Counter<'outcome'>;

  // ── SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router ──
  private axisLabelsTotal!: Counter<'tenant_top' | 'axis' | 'source'>;
  private routerFallbackCallsTotal!: Counter<'tenant_top' | 'result'>;
  private routerFallbackCacheHitTotal!: Counter<'tenant_top'>;
  private axisClassifyDurationSeconds!: Histogram<'axis'>;

  // ── SBA α-9 wave 3 — Company Foundation (CompanyProfile / Domains / Maturity) ──
  private maturityScoreAvg!: Gauge<'tenant_top' | 'scope'>;
  private domainsTotal!: Gauge<'tenant_top'>;
  private departmentsTotal!: Gauge<'tenant_top'>;
  private companyProfileCompleteness!: Gauge<'tenant_top'>;
  private domainExpanderCreatedTotal!: Counter<'tenant_top'>;
  private maturityScorerDurationSeconds!: Histogram<'scope'>;

  // ── SBA α-8 wave 3 — Appointment + KPI (replacement для PersonRole) ──
  private appointmentsTotal!: Gauge<'tenant_top' | 'status'>;
  private kpiMeasurementsTotal!: Counter<'tenant_top'>;
  private kpiOverdueMeasurementsTotal!: Gauge<'tenant_top' | 'frequency'>;
  private personRoleToAppointmentMigrationProgress!: Gauge<'tenant_top'>;

  // ── SBA β-7 — Brand Voice Curator (Specialist 3.10) ────────────────
  // Cardinality-safe: label `tenant_top` — top-100 bucket (hash mod 100 +
  // 'other'). Не `tenantId`, иначе ряды gauge'а взорвутся на масштабе.
  private brandVoiceProfileCompleteness!: Gauge<'tenant_top'>;
  private brandVoiceExtractorRunsTotal!: Counter<'tenant_top' | 'result'>;
  private brandVoiceCorpusSize!: Gauge<'tenant_top'>;

  // ── SBA β-6 — Experiment Tracker (Specialist 3.9) ──────────────────
  // Cardinality-safe: `tenant_top` (top-100 + 'other'), `status` ограничен 5
  // допустимыми значениями (hypothesis|running|completed|dropped|paused).
  private experimentsTotal!: Gauge<'tenant_top' | 'status'>;
  private experimentsRunningDurationDays!: Histogram<'tenant_top'>;
  private experimentsLessonsExtractedTotal!: Counter<'tenant_top'>;
  private experimentDetectorRunsTotal!: Counter<'tenant_top' | 'result'>;

  // ── SBA α-8 wave 4 — Role Map builder + completeness cron ────────────
  // Cardinality-safe: tenant_top — top-100 bucket (hash mod 100) + 'other'.
  // result ∈ {built|skipped_below_threshold|skipped_disabled|llm_error|db_error}.
  private roleMapCompletenessAvg!: Gauge<'tenant_top'>;
  private roleMapBuilderRunsTotal!: Counter<'tenant_top' | 'result'>;
  private roleMapExtractDurationSeconds!: Histogram<never>;
  private rolesWithNormalizedDataRatio!: Gauge<'tenant_top'>;

  // ── SBA δ-3 — VoiceChannelAdapter (TTS + ASR REST) ─────────────────
  // Cardinality-safe: tenant_top — top-100 bucket (hash mod 100 + 'other').
  // provider ∈ vox | gigaam | openai | yandex (фиксированный набор);
  // НЕ выносим конкретный голос (alloy/echo/...) — это бы взорвало серии.
  private voiceAsrRequestsTotal!: Counter<'tenant_top' | 'provider'>;
  private voiceAsrDurationSeconds!: Histogram<'provider'>;
  private voiceTtsRequestsTotal!: Counter<'tenant_top' | 'provider'>;
  private voiceTtsCharsTotal!: Counter<'tenant_top'>;

  // ── T4 / δ-3 — VoiceStreamGateway (WS chunk streaming) ───────────────
  // Cardinality-safe: только outcome label. Без tenant — счётчик внутренний,
  // нагрузка считается по chunks/ASR-latency.
  private voiceWsSessionTotal!: Counter<'outcome'>;
  private voiceWsChunkTotal!: Counter<never>;
  private voiceWsAsrLatencyMs!: Histogram<never>;

  // ── SBA β-8 — DailyCheckIn + Operations + PersonalRelation ─────────
  // Cardinality-safe: tenant_top — top-100 bucket; kind ограничен
  // 'morning'|'evening'; severity — 'low'|'medium'|'high'|'unknown'.
  private dailyCheckinsCompletedTotal!: Counter<'tenant_top' | 'kind'>;
  private dailyCheckinsSkippedTotal!: Counter<'tenant_top' | 'kind' | 'reason'>;
  private operationsBlockersTotal!: Gauge<'tenant_top' | 'severity'>;
  private teamFrictionsTotal!: Gauge<'tenant_top'>;
  private goalCascadeMissesTotal!: Counter<'tenant_top'>;
  private personalRelationBuilderRunsTotal!: Counter<'tenant_top' | 'result' | 'source'>;

  // ── ТЗ-2 Ф1 — отдача главной директора (новая компоновка) ─────────
  // Cardinality-safe: tenant_top — top-100 bucket через tenantTopOf.
  private dashboardValueStripServedTotal!: Counter<'tenant_top'>;
  private dashboardMainFirstScreenWidgetCount!: Gauge<'tenant_top'>;

  // ── ТЗ-2 Ф4 — недельный план-факт по людям (self-view + «без ответа») ──
  // Cardinality-safe: tenant_top — top-100 bucket через tenantTopOf.
  private weeklyPerPersonSelfViewServedTotal!: Counter<'tenant_top'>;
  private weeklyPerPersonNoAnswerTotal!: Counter<'tenant_top'>;

  // ── ТЗ-2 Ф5 — виджеты ежедневной ценности в /me (self-эндпоинты) ──
  // Cardinality-safe: tenant_top — top-100 bucket через tenantTopOf.
  private myIdeasFateServedTotal!: Counter<'tenant_top'>;
  private myRecognitionsServedTotal!: Counter<'tenant_top'>;

  // ── SBA β-8.1 — добивка панели операционного директора ────────────
  // Cardinality-safe: tenant_top — top-100 bucket; sentiment — 'green'|'yellow'|'red'.
  private cooSentimentAnalyzedTotal!: Counter<'tenant_top' | 'sentiment'>;
  // reason: 'invalid_element' — silent-skip кривого элемента batch-парсером;
  //         'other' — LLM упал/timeout/нет tool_call/update в БД упал.
  // Cardinality: 2 значения reason × ≤101 tenant_top = ≤202 series.
  private cooSentimentFailedTotal!: Counter<'tenant_top' | 'reason'>;
  // ТЗ 2026-06-10-daily-checkin-to-graph-bridge — мост чек-ин → knowledge-core.
  // result ∈ ok (RawEvent создан/идемпотентный возврат) | skipped (completedAt=
  // null / нет записи / флаг off) | error (исключение моста, best-effort). 3 series.
  private checkinGraphIngestTotal!: Counter<'result'>;
  private cooWeeklyDigestGeneratedTotal!: Counter<'tenant_top'>;
  private cooWeeklyDigestFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private cooTeamTemperatureRedShare!: Gauge<'tenant_top'>;
  // ── ТЗ-2 Ф2 — «зеркало закрытого» + capacity-виджет COO ──
  // Cardinality-safe: tenant_top — top-100 bucket (resolveOperationsTenantTop).
  private cooBlockersResolvedTotal!: Gauge<'tenant_top'>;
  private cooTeamCapacityWidgetServedTotal!: Counter<'tenant_top'>;

  // ── SBA β-8.3 — ежедневный отчёт COO ──────────────────────────────
  // Cardinality-safe: tenant_top — top-100 bucket; reason — короткий
  // whitelist ('llm_failed' | 'aggregation_failed' | 'notify_failed' | 'exception').
  // channel — 'conversational' (через α-1 ConversationalService).
  private cooDailyDigestGeneratedTotal!: Counter<'tenant_top'>;
  private cooDailyDigestFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private cooDailyDigestDeliveredTotal!: Counter<'tenant_top' | 'channel'>;
  private cooDailyDigestAgeSeconds!: Gauge<'tenant_top'>;

  // ── «Месяц компании» — месячный отчёт COO ─────────────────────────
  private cooMonthlyDigestGeneratedTotal!: Counter<'tenant_top'>;
  private cooMonthlyDigestFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private cooMonthlyDigestDeliveredTotal!: Counter<'tenant_top' | 'channel'>;

  // ── TZ-1 Ф3.D (daily-value-engine) — фиксы достоверности агентов ────
  // Cardinality-safe: tenant_top — top-100 bucket; trigger — фиксированный
  // whitelist probe-триггеров (reply_latency_rise|workload_overload|
  // meeting_noshows).
  // - commitment_author_coverage_ratio: доля commitment с непустым
  //   commitmentAuthorPersonId в прогоне goal-vector (0..1). Ниже
  //   goals.author_coverage_min → fallback на адресата.
  // - probe_suggested_total: сработавший risk/probe-триггер burnout-детектора.
  private commitmentAuthorCoverageRatio!: Gauge<'tenant_top'>;
  private probeSuggestedTotal!: Counter<'trigger'>;

  // ── SBA β-8.3 Wave 2 — COO overview расширения ─────────────────────
  // Cardinality-safe: tenant_top — top-100 bucket; cause — фиксированный
  // whitelist из 8 значений `Insight.causeCategory`.
  private cooInsightsByCauseTotal!: Gauge<'tenant_top' | 'cause'>;
  private cooCompanyMaturityScore!: Gauge<'tenant_top'>;

  // ── SBA β-8.2 — Promise Keeper («Хранитель обещаний») ──────────────
  // Cardinality-safe: tenant_top — top-100 bucket; reason — короткий
  // whitelist причин («llm_failed', 'parse_failed', 'no_block', 'exception').
  private commitmentsOpenTotal!: Gauge<'tenant_top'>;
  private commitmentsAskedTotal!: Counter<'tenant_top'>;
  private commitmentsFulfilledTotal!: Counter<'tenant_top'>;
  private commitmentsMissedTotal!: Counter<'tenant_top'>;
  private commitmentsEscalatedTotal!: Counter<'tenant_top'>;
  private commitmentsExtractFailedTotal!: Counter<'tenant_top' | 'reason'>;

  // ── SBA γ-2 — Concierge Agent ──────────────────────────────────────
  // Cardinality-safe: `tenant_top` — top-100 bucket (hash mod 100);
  // `tool` — имя whitelist tool'а (ограниченный набор ServiceMap'а);
  // `scope` ∈ daily|monthly; `status` ∈ ok|error|forbidden.
  private conciergeMessagesTotal!: Counter<'tenant_top'>;
  private conciergeToolCallsTotal!: Counter<'tenant_top' | 'tool' | 'status'>;
  private conciergeUndoTotal!: Counter<'tenant_top' | 'tool'>;
  private conciergeQuotaExceededTotal!: Counter<'tenant_top' | 'scope'>;
  // ТЗ 2026-05-27 Фаза 4 — dialog-layer наблюдаемость.
  // Cardinality-safe: `intent` — фиксированный whitelist (factual|exploratory|
  // analytical|clone_roleplay|unknown), значения обрезаются по 32 символа
  // для защиты от мусора. `cache_hit` — без labels. `pre_retrieval_hits` —
  // histogram (sample = total hits across queries).
  private conciergeDialogLayerUsedTotal!: Counter<'intent'>;
  private conciergeCacheHitTotal!: Counter<string>;
  private conciergePreRetrievalHitsCount!: Histogram<string>;

  // ── SBA δ-1 — Orchestrator (multi-agent research) ───────────────────
  // Cardinality-safe: `status` ∈ done|failed|timeout|cancelled;
  // `agent_type` ∈ entity_research|comparison|topic_summary|timeline_construction
  // (фиксированный whitelist); `result` ∈ done|failed|low_confidence.
  // Никакого tenant в labels — top-100 агрегацию делает Grafana поверх БД.
  private orchestratorRunsTotal!: Counter<'status'>;
  private orchestratorSubagentsTotal!: Counter<'agent_type' | 'result'>;
  private orchestratorRunDurationSeconds!: Histogram<never>;
  private orchestratorVerificationLowConfidenceTotal!: Counter<never>;

  // ── SBA δ-2 — ProactiveWatcher ─────────────────────────────────────
  // Cardinality-safe: `rule` — ограниченный whitelist (8 значений),
  // `severity` ∈ low|medium|high. Никакого tenant в labels — top-100
  // агрегацию делает Grafana поверх БД (ProactiveNotification.tenantId).
  private proactiveNotificationsEmittedTotal!: Counter<'rule' | 'severity'>;
  private proactiveNotificationsDismissedTotal!: Counter<'rule'>;
  private proactiveNotificationsDedupSkippedTotal!: Counter<never>;
  private proactiveWatcherDurationSeconds!: Histogram<'rule'>;

  // ── α-10 wave 3 — Admin LLM + Unit Economics ────────────────────────
  // Cardinality-safe: tenant_top top-100 (нормализация на caller'е),
  // task_type top-50 (enum-like), provider/model — bounded registry.
  private aiCostUsdLabeledTotal!: Counter<
    'tenant_top' | 'task_type' | 'provider' | 'model'
  >;
  private aiCostRubLabeledTotal!: Counter<
    'tenant_top' | 'task_type' | 'provider' | 'model'
  >;
  private aiCallsLabeledTotal!: Counter<
    'tenant_top' | 'task_type' | 'provider' | 'model' | 'success'
  >;
  private orgBudgetUtilizationPercent!: Gauge<'tenant_top'>;
  private providerSmokeTestSuccess!: Gauge<'provider'>;
  private providerSmokeTestDurationSeconds!: Histogram<'provider'>;
  private currencyRateUsdRub!: Gauge<string>;
  private currencyRateSyncTotal!: Counter<'result'>;
  private dailyCostAggregatorRunsTotal!: Counter<'result'>;
  private orgEconomicsRunsTotal!: Counter<'result'>;
  private budgetAlertSentTotal!: Counter<'threshold'>;

  // ── Tracker (Sprint 1 — D-1.2) ──────────────────────────────────────
  // См. plans/tz/2026-05-23-tracker-phase-1-models-api.md §"Метрики
  // Prometheus" и plans/sprints/2026-05-24-sprint-plan-wave-1.md (D-1.2).
  //
  // TODO (cardinality, Sprint 7 — Grafana onboarding): label `tenant`
  //    разрастается на масштабе сотен Org. Нормализация в `tenant_top`
  //    (top-100 hash bucket + 'other') — паттерн из остальных tenant_top-
  //    метрик. На Sprint 1 принимаем как `tenant` для прямой связки с
  //    `Issue.tenantId`/`IntakeIssue.tenantId`/`Webhook.tenantId`; downgrade
  //    к `tenant_top` сделаем в Sprint 7 одновременно с подключением
  //    recording rule в Prometheus. То же про `project` (label на UUID).
  //    Реально `.inc()` НЕ вызывается ни одним сервисом на Sprint 1 — это
  //    делают tracker-сервисы на Sprint 2+. До этого момента series пустые.
  //
  // TODO (cardinality, Sprint 7): `webhook_id` в `webhook_retry_count` —
  //    high-cardinality (UUID per webhook). Альтернатива: counter без
  //    `webhook_id` + аналитика retries по `webhook_id` через event-log
  //    в БД. Решим вместе с командой DevOps при подключении Grafana.
  private issuesCreatedTotal!: Counter<'tenant' | 'project' | 'source'>;
  private issuesCompletedTotal!: Counter<'tenant' | 'project'>;
  // Tracker (2026-05-27) — подзадачи (Issue с parentId !== null).
  // Инкрементится в IssuesService.create() когда передан parentId.
  // Контракт: plans/tz/2026-05-27-tracker-subtasks-ui.md "Метрики".
  private subtasksCreatedTotal!: Counter<'tenant' | 'project'>;
  private intakeTriagedTotal!: Counter<'tenant' | 'decision'>;
  private trackerWebhookDeliveryTotal!: Counter<'tenant' | 'event' | 'success'>;
  private trackerWebhookRetryCount!: Counter<'tenant' | 'webhook_id'>;
  private trackerEventsToKnowledgeCoreTotal!: Counter<'tenant' | 'type'>;
  // Tracker Phase 3 (2026-05-24) — Issue embedding + similar-search.
  // tenant_top — cardinality-safe label (top-100 bucket через `tenantTopOf`).
  private trackerIssueEmbedTotal!: Counter<'tenant_top' | 'status'>;
  private trackerIssueSimilarSearchTotal!: Counter<'tenant_top'>;
  // Tracker Checklists (2026-05-27, plans/tz/2026-05-27-tracker-checklists.md).
  //   checklists_created_total{tenant, project} — создание чек-листа на задаче.
  //   checklist_items_added_total{tenant, project, via_bulk} — пункт добавлен;
  //     via_bulk='true' если через bulk-create endpoint, иначе 'false'.
  //   checklist_items_completed_total{tenant, project} — пункт переведён в
  //     isDone=true (включая случаи перехода обратно — этот счётчик считает
  //     именно факт «done++», не «done--»).
  private checklistsCreatedTotal!: Counter<'tenant' | 'project'>;
  private checklistItemsAddedTotal!: Counter<'tenant' | 'project' | 'via_bulk'>;
  private checklistItemsCompletedTotal!: Counter<'tenant' | 'project'>;
  // Tracker Project Documents (2026-05-27, plans/tz/2026-05-27-tracker-project-documents.md).
  //   project_documents_created_total{tenant, project} — создание документа.
  //   project_documents_updated_total{tenant, project} — auto-save / explicit PATCH.
  //   linked_cards_view_total{tenant, project} — открыт блок «Связанные карточки».
  private projectDocumentsCreatedTotal!: Counter<'tenant' | 'project'>;
  private projectDocumentsUpdatedTotal!: Counter<'tenant' | 'project'>;
  private linkedCardsViewTotal!: Counter<'tenant' | 'project'>;
  // Tracker Phase 3 part C (2026-05-24) — AI-suggest при создании задачи.
  // ai_issue_inferred_total{tenant_top, accepted} — увеличивается на inference
  //   (accepted='false'); если позже PATCH принимает hint — отдельным вызовом
  //   с accepted='true' (фронт сообщает через future endpoint).
  // ai_issue_goal_suggested_total{tenant_top, accepted, source} — KNN vs LLM
  //   (source='knn'|'llm'|'none'). accepted аналогично.
  private aiIssueInferredTotal!: Counter<'tenant_top' | 'accepted'>;
  private aiIssueGoalSuggestedTotal!: Counter<
    'tenant_top' | 'accepted' | 'source'
  >;
  // Tracker Phase 3 part B (2026-05-24) — meeting-extract-actions + auto-triage Intake.
  // ai_meeting_actions_extracted_total{tenant_top, status} — status='created'|'skipped_idempotent'|'llm_empty'|'llm_error'.
  //   Caller — `MeetingExtractActionsService`. Каждый вызов = одна метрика.
  //   count извлечённых задач отдельно через `incBy` (см. ниже).
  // ai_intake_auto_accepted_total{tenant_top} — IntakeIssue, который IntakeAutoTriageWorker
  //   автоматически перевёл в accepted (создав Issue). Условие: confidence ≥ 0.92
  //   + source='meeting' + suggestedAssigneeId != null.
  // ai_intake_suggested_total{tenant_top, accepted_or_pending} — IntakeIssue, для которого
  //   worker заполнил suggested* (но не auto-accepted). accepted_or_pending — для
  //   совместимости с метрикой auto_accepted (легче считать ratio).
  private aiMeetingActionsExtractedTotal!: Counter<'tenant_top' | 'status'>;
  private aiIntakeAutoAcceptedTotal!: Counter<
    'tenant_top' | 'source' | 'via_default_project'
  >;
  private aiIntakeSuggestedTotal!: Counter<'tenant_top' | 'status' | 'source'>;
  // Tracker Phase 5 part 1 (2026-05-24) — Import-tracker метрики.
  // Cardinality-safe: tenant_top — top-100 bucket (паттерн как у остальных
  // tracker tenant_top-метрик); source — фиксированный enum (trello |
  // bitrix24 | yandex_tracker); success — 'true'|'false' (паттерн
  // trackerWebhookDeliveryTotal).
  private importStartedTotal!: Counter<'tenant_top' | 'source'>;
  private importCompletedTotal!: Counter<'tenant_top' | 'source' | 'success'>;
  private importIssuesProcessedTotal!: Counter<'tenant_top' | 'source'>;
  private issuesByStateCount!: Gauge<'tenant' | 'project' | 'state'>;
  private issuesOverdueCount!: Gauge<'tenant' | 'project'>;
  private intakePendingCount!: Gauge<'tenant'>;
  // Tracker Phase 4 part 2 (Sprint 9, 2026-05-24) — TeamTemplate + HolidayCalendar.
  // team_template_used_total{tenant_top, slug} — Project создан через
  //   POST /projects/from-template (инкрементируется одновременно с TeamTemplate.usageCount).
  // holiday_due_date_adjusted_total{tenant_top} — IssuesService сдвинул dueDate
  //   на следующий рабочий день из-за попадания на праздник
  //   (HolidayService.adjustDueDate; интеграция в IssuesService — Sprint 10).
  private teamTemplateUsedTotal!: Counter<'tenant_top' | 'slug'>;
  private holidayDueDateAdjustedTotal!: Counter<'tenant_top'>;
  // Tracker Boards (2026-05-27) — несколько досок per project (Weeek/Kaiten-паритет).
  // Cardinality-safe: tenant_top — top-100 bucket; project — UUID (десятки/сотни
  // на tenant, приемлемо); board — board-UUID (используется только в moved-метрике,
  // десятки на проект).
  //   - boards_created_total{tenant_top, project}
  //   - boards_archived_total{tenant_top, project}  (счёт архивации, без soft-delete)
  //   - board_issues_moved_total{tenant_top, from_board, to_board}
  // ТЗ: plans/tz/2026-05-27-tracker-boards.md §"Метрики Prometheus".
  private boardsCreatedTotal!: Counter<'tenant_top' | 'project'>;
  private boardsArchivedTotal!: Counter<'tenant_top' | 'project'>;
  private boardIssuesMovedTotal!: Counter<'tenant_top' | 'from_board' | 'to_board'>;
  // Issue move-to-project (2026-06-15, plans/tz/2026-06-15-issue-move-to-project.md)
  //   - issue_moved_to_project_total{tenant_top} — задача перенесена в другой
  //     проект (POST /issues/:id/move). Без project-меток (cardinality-safe).
  private issueMovedToProjectTotal!: Counter<'tenant_top'>;
  // Tracker Phase 4 (Email-to-task, T5, 2026-05-24) — поллинг общего IMAP-ящика
  // (`inbox.kora.app`) → routing по To:-alias → IssuesService.create().
  // Cardinality-safe: project — id (десятки/сотни на tenant; в проде следить).
  //   - z_mail_inbound_received_total{project_id, status} — все обработанные письма.
  //   - z_mail_inbound_issues_created_total — Issue.create() удалось.
  //   - z_mail_inbound_bounce_total{reason} — alias не найден / выключен / etc.
  //   - z_mail_inbound_attachment_uploaded_total — вложение пушнули в S3.
  private mailInboundReceivedTotal!: Counter<'project_id' | 'status'>;
  private mailInboundIssuesCreatedTotal!: Counter<string>;
  private mailInboundBounceTotal!: Counter<'reason'>;
  private mailInboundAttachmentUploadedTotal!: Counter<string>;
  // Wave 3 finishing (Sprint 10, 2026-05-24) — probe `goal_alignment_low`:
  // у user'а ≥80% задач за 14д созданы без связи с целью (Goal). Probe
  // эмитит `GoalAlignmentLowCron` (понедельник 06:00 UTC).
  private probeGoalAlignmentLowEmittedTotal!: Counter<'tenant_top'>;

  // ── Wave 2 Поток D — Activity Feeds (2026-05-24) ────────────────────
  // См. plans/tz/2026-05-23-activity-feeds.md §"Метрики Prometheus".
  // Cardinality-safe: tenant — top-100 в Sprint 7 (как и в tracker-метриках);
  // feed_type ∈ probe_question|insight|decision|task|idea|conflict|knowledge_change
  // (фиксированный enum); severity ∈ critical|high|normal|low; reaction ∈ thanks|vote.
  private feedItemsEmittedTotal!: Counter<'tenant' | 'feed_type' | 'severity'>;
  private feedItemsActionedTotal!: Counter<'tenant' | 'feed_type' | 'status'>;
  private feedReactionsTotal!: Counter<'tenant' | 'feed_type' | 'reaction'>;
  private feedItemsExpiredTotal!: Counter<'tenant' | 'feed_type'>;

  // ── Calendar MVP (2026-05-25) ───────────────────────────────────────
  // Cardinality-safe: tenant — top-100 bucket (паттерн tracker'а);
  // kind — фиксированный enum EventKind (~10 значений);
  // visibility ∈ company|team|personal; channel ∈ push|email|telegram;
  // success ∈ 'true'|'false'; found ∈ 'true'|'false'.
  private calendarEventsCreatedTotal!: Counter<'tenant' | 'kind' | 'visibility'>;
  private calendarRemindersSentTotal!: Counter<'tenant' | 'channel' | 'success'>;
  private calendarFindFreeSlotTotal!: Counter<'tenant' | 'found'>;

  // ── Feedback channel + AI clustering (ТЗ 2026-05-25) ───────────────
  // Канал «Ваши предложения» с ночным AI-прогоном (01:00 UTC).
  // Cardinality-safe: метрики глобальные (без tenant — фидбэк не tenant-bound,
  // это сообщения пользователей супер-админу Z). Label `result` для
  // `feedback_digest_runs_total` — фиксированный whitelist:
  //   success | skipped | lock_held | agent_failed | txn_failed | anomaly.
  private feedbackDigestRunsTotal!: Counter<'result'>;
  private feedbackDigestMessagesProcessedTotal!: Counter<never>;
  private feedbackDigestNewTopicsTotal!: Counter<never>;
  private feedbackDigestFailedRunsTotal!: Counter<never>;

  // ── Onboarding Tour (ТЗ 2026-05-27) ───────────────────────────────────
  // Cardinality-safe: tenant — id Org (топ-100 без дальнейшей нормализации,
  // tracker-паттерн); tour_id — фиксированный enum (welcome|project|meeting);
  // at_step — id шага из tour-definition (например "welcome.sidebar-meetings"),
  // фиксированный по коду фронта (< 30 значений).
  private tourStartedTotal!: Counter<'tenant' | 'tour_id'>;
  private tourCompletedTotal!: Counter<'tenant' | 'tour_id'>;
  private tourSkippedTotal!: Counter<'tenant' | 'tour_id' | 'at_step'>;

  // ── Sprints (ТЗ 2026-05-27) ───────────────────────────────────────────
  // Cardinality-safe: tenant — id Org; scope_kind / kind / status / result —
  // фиксированные enum'ы (≤10 значений).
  private cyclesCreatedTotal!: Counter<'tenant' | 'scope_kind'>;
  private cyclesCompletedTotal!: Counter<'tenant'>;
  private sprintHintsTotal!: Counter<'tenant' | 'kind' | 'status'>;
  private sprintHintDismissedTotal!: Counter<'tenant' | 'kind'>;
  private sprintDashboardCacheHitTotal!: Counter<'tenant'>;
  private sprintDashboardCacheMissTotal!: Counter<'tenant'>;
  private sprintHelperRunsTotal!: Counter<'tenant' | 'status'>;
  private sprintHelperDurationSeconds!: Histogram<'tenant'>;
  private sprintReviewGenerationTotal!: Counter<'tenant' | 'status'>;
  private sprintReviewGenerationDurationSeconds!: Histogram<'tenant'>;

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

    this.recordingTrackEgressFailedTotal = this.getOrCreateCounter({
      name: 'recording_track_egress_failed_total',
      help: 'Сколько стартов per-track audio egress упало (дорожка не собралась). Алерт при росте = потеря дорожек/деградация транскрипта.',
      labelNames: ['reason'] as const,
    });

    this.recordingTrackWatchdogTotal = this.getOrCreateCounter({
      name: 'recording_track_watchdog_total',
      help: 'F5 watchdog зависших аудио-дорожек: outcome=forced (деградировал застрявшую дорожку и переинициировал финализацию → транскрипция стартовала по готовым дорожкам) | skipped (кандидат найден, но ещё не готов к форсу). Рост forced = egress-вебхуки дорожек теряются, нужен алерт.',
      labelNames: ['outcome'] as const,
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

    this.livekitEgressEndedGapSeconds = this.getOrCreateHistogram({
      name: 'livekit_egress_ended_gap_seconds',
      help: 'Задержка между room_finished и egress_ended (доставка egress-вебхука)',
      labelNames: ['request_type'] as const,
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1200],
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

    this.llmCostUnpricedTotal = this.getOrCreateCounter({
      name: 'llm_cost_unpriced_total',
      help: 'LLM-вызов модели без цены (нет ни в LlmModelPrice, ни в MODEL_PRICES) → costUsd молча = 0, расход невидим. > 0 → заполни цену в админке.',
      labelNames: ['provider', 'model'] as const,
    });

    this.kcBlockLinkerFallbackNoneTotal = this.getOrCreateCounter({
      name: 'kc_block_linker_fallback_none_total',
      help: 'block-linker не смог распарсить вердикт арбитра после ретраев → связь не создана (молчаливая деградация графа). > 0 → проверь модель/формат.',
      labelNames: ['reason'] as const,
    });

    this.kcBlockLinkerInvalidJsonTotal = this.getOrCreateCounter({
      name: 'kc_block_linker_invalid_json_total',
      help: 'block-linker: невалидный ответ арбитра на попытке (reason=parse — не распарсился JSON-вердикт; reason=llm_error — вызов LLM упал). Доля растёт → проблема с моделью/форматом; терминальные потери — в kc_block_linker_fallback_none_total.',
      labelNames: ['reason'] as const,
    });

    this.kcEntityGraphInvalidJsonTotal = this.getOrCreateCounter({
      name: 'kc_entity_graph_invalid_json_total',
      help: 'entity-graph: невалидный ответ LLM-арбитра на попытке (reason=parse — не распарсился JSON; reason=llm_error — вызов LLM упал). Терминальные потери — в kc_entity_graph_fallback_none_total.',
      labelNames: ['reason'] as const,
    });

    this.kcEntityGraphFallbackNoneTotal = this.getOrCreateCounter({
      name: 'kc_entity_graph_fallback_none_total',
      help: 'entity-graph не смог распарсить вердикт арбитра после ретраев → связь сущностей не создана (молчаливая деградация графа). > 0 → проверь модель/формат.',
      labelNames: ['reason'] as const,
    });

    // Ф5 Р2 — семантический дедуп задач встречи. result:
    //   knn_merged — fast-черновик удалён по cosine >= порога (без LLM);
    //   llm_merged — удалён по вердикту 'same' LLM-арбитра (серая зона);
    //   kept       — оставлен (нет близкого canonical или вердикт 'different');
    //   skipped    — дедуп пропущен (флаг OFF / embed упал / ошибка).
    this.taskDedupeTotal = this.getOrCreateCounter({
      name: 'z_task_dedupe_total',
      help: 'Ф5 Р2 — семантический дедуп задач встречи. result=knn_merged|llm_merged|kept|skipped.',
      labelNames: ['result'] as const,
    });

    this.taskDedupSuggestedTotal = this.getOrCreateCounter({
      name: 'task_dedup_suggested_total',
      help: 'TZ task-dedup WP-J — дедуп-гейт прямого create вернул verdict=same (заведена связь duplicates, suggest).',
      labelNames: ['tenant_top'] as const,
    });

    this.morningTasksDigestTotal = this.getOrCreateCounter({
      name: 'z_tracker_morning_digest_total',
      help: 'Утренняя сводка задач: отправлено уведомлений. is_empty=true|false (пустой день или со списком).',
      labelNames: ['is_empty'] as const,
    });

    this.taskClosureOutcomeTotal = this.getOrCreateCounter({
      name: 'z_task_closure_outcome_total',
      help: 'TZ task-loop Ф2b — исход TaskCompletionHandler. outcome=created|no_match|not_done|embed_fail|disabled|skipped_tracker|dropped_merged|no_text. Падение created при росте сигналов → петля закрытия деградирует.',
      labelNames: ['outcome'] as const,
    });

    // ChatBox синк/анализ (ТЗ 2026-06-11 remaining-handoff Ф3).
    this.chatboxSyncsTotal = this.getOrCreateCounter({
      name: 'z_chatbox_syncs_total',
      help: 'Ф3 — синк ChatBox per scope. status=success|failed. Падения видны сразу (раньше синк-ошибка была только в логе воркера).',
      labelNames: ['scope', 'status'] as const,
    });
    this.chatboxAnalyzesTotal = this.getOrCreateCounter({
      name: 'z_chatbox_analyzes_total',
      help: 'Ф3 — анализ закрытой сессии чата (LLM-summary + мост в граф). status=success|failed.',
      labelNames: ['status'] as const,
    });
    this.chatboxTasksOwnerMissingTotal = this.getOrCreateCounter({
      name: 'z_chatbox_tasks_owner_missing_total',
      help: 'Ф3 — задачи из переписки пропущены: у Org нет ни одного участника (owner/admin/any не найден). Аномалия, а не штатный пропуск — алёрт при росте.',
    });
    this.chatboxPendingSessions = this.getOrCreateGauge({
      name: 'z_chatbox_pending_sessions',
      help: 'Ф3 — сколько закрытых сессий чата ждут анализа (analysisStatus=pending, по всем org). Растёт и не убывает → анализ встал.',
    });
    this.chatboxStuckAnalyzing = this.getOrCreateGauge({
      name: 'z_chatbox_stuck_analyzing_sessions',
      help: 'Сколько сессий чата зависло в analysisStatus=analyzing дольше chatbox.analyze.stuckAnalyzingMin (воркер умер между analyzing и done/failed). Ненулевое дольше интервала sweep → анализ виснет.',
    });
    this.chatboxLastSyncTsSeconds = this.getOrCreateGauge({
      name: 'z_chatbox_last_sync_ts_seconds',
      help: 'Ф3 — unixtime последнего успешного синка ChatBox per scope. time()-max(...)>7200 → синк отстал.',
      labelNames: ['scope'] as const,
    });

    // T7-F3 — prompt caching distribution. Помогает увидеть hit-rate и
    // объём токенов, экономящихся за счёт кеша Anthropic (cache_read ≈ 0.1×
    // input price, cache_creation ≈ 1.25× для 5min-TTL). Алёрт: cache_hit
    // rate резко упал → silent invalidator в системе (timestamp / UUID
    // в system prompt, недетерминированный JSON и т.п.).
    this.llmCacheHitTotal = this.getOrCreateCounter({
      name: 'z_llm_cache_hit_total',
      help: 'T7-F3 — счётчик LLM-вызовов с cache_read > 0. Делить на общее число успешных вызовов = hit rate.',
      labelNames: ['provider', 'model', 'task_type'] as const,
    });
    this.llmCacheReadTokensTotal = this.getOrCreateCounter({
      name: 'z_llm_cache_read_tokens_total',
      help: 'T7-F3 — суммарно токенов, прочитанных из prompt cache (cost ~0.1× input price).',
      labelNames: ['provider', 'model'] as const,
    });
    this.llmCacheCreationTokensTotal = this.getOrCreateCounter({
      name: 'z_llm_cache_creation_tokens_total',
      help: 'T7-F3 — суммарно токенов, записанных в prompt cache (cost ~1.25× input price для 5min-TTL). Релевантно только Anthropic-семейству.',
      labelNames: ['provider', 'model'] as const,
    });
    // Ф6 Часть 3 — общее число успешных LLM-вызовов per provider (знаменатель
    // cache hit-ratio). z_llm_cache_hit_total / z_llm_calls_total = доля хитов.
    this.llmCallsTotal = this.getOrCreateCounter({
      name: 'z_llm_calls_total',
      help: 'Ф6 — счётчик успешных LLM-вызовов per provider. Знаменатель для cache hit-ratio (z_llm_cache_hit_total / z_llm_calls_total).',
      labelNames: ['provider'] as const,
    });
    this.llmCacheHitRatioBelowThreshold = this.getOrCreateGauge({
      name: 'z_llm_cache_hit_ratio_below_threshold',
      help: 'Ф6 — 1, если доля prompt-cache хитов по провайдеру ниже порога (smoke-cron), иначе 0. Алёрт: дрейф на некэширующий провайдер.',
      labelNames: ['provider'] as const,
    });

    this.deepseekSchemaToToolConversionTotal = this.getOrCreateCounter({
      name: 'z_deepseek_schema_to_tool_conversion_total',
      help: 'ТЗ 2026-05-25 — автоконвертация json_schema → tool в DeepSeekService (Pro thinking-mode не поддерживает strict json_schema). Высокое значение = много caller-ов всё ещё на json_schema; кандидат на массовый перевод на tools.',
      labelNames: ['model'] as const,
    });

    this.llmThinkingModelGuardTotal = this.getOrCreateCounter({
      name: 'z_llm_thinking_model_guard_total',
      help: 'ТЗ 2026-05-25 Фаза 1 — автоматическая подмена параметров для thinking-моделей (DeepSeek-V4-Pro / *-pro / *-thinking) во избежание 400. kind: schema-to-tool | strict-stripped | tool-choice-relaxed.',
      labelNames: ['kind', 'model'] as const,
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

    this.promptInjectionAttemptTotal = this.getOrCreateCounter({
      name: 'z_prompt_injection_attempt_total',
      help: 'Попытки prompt-injection (ТЗ 2026-05-24 §4): сработавший regex-паттерн в пользовательском вводе. Сама попытка не блокирует — структурный слой обернёт текст в маркеры. Метрика для observability/alertов.',
      labelNames: ['source', 'pattern'] as const,
    });

    this.promptInvalidResponseTotal = this.getOrCreateCounter({
      name: 'z_prompt_invalid_response_total',
      help: 'Невалидный ответ LLM (ТЗ 2026-05-24 §9 F6): не парсится JSON / не проходит Zod-схему / отсутствует ожидаемый tool_use. Накапливается на каждый retry, не только финальный fail.',
      labelNames: ['task_type', 'model', 'reason'] as const,
    });

    this.queryPlanExtractionTotal = this.getOrCreateCounter({
      name: 'z_query_plan_extraction_total',
      help: 'Query Understanding Волна 1 — извлечение структуры запроса (dialog-extract-plan). result="applied" план применён (фильтр); "failopen" низкий confidence/невалидный JSON/LLM упал → смысловой путь без фильтра.',
      labelNames: ['result'] as const,
    });
    this.queryPlanRetrievalFilteredTotal = this.getOrCreateCounter({
      name: 'z_query_plan_retrieval_filtered_total',
      help: 'Query Understanding Волна 1 — chat-v2 retrieval: filtered="yes" применён структурный recall-safe фильтр (полный скан), "no" обычный смысловой путь.',
      labelNames: ['filtered'] as const,
    });
    this.queryPlanEmptyPoolTotal = this.getOrCreateCounter({
      name: 'z_query_plan_empty_pool_total',
      help: 'Query Understanding Волна 1 — misroute-proxy: применённый структурный фильтр дал ПУСТОЙ пул (честный ответ «в памяти нет»). Рост может означать слишком узкий/неверный фильтр.',
      labelNames: ['result'] as const,
    });
    this.routerQueryClassTotal = this.getOrCreateCounter({
      name: 'z_router_query_class_total',
      help: 'Слой источника Ф3 — детерминированный роутер запроса: распределение запросов по 5 классам (list/topic/temporal/overview/fact).',
      labelNames: ['class'] as const,
    });
    this.routerBothWaysTotal = this.getOrCreateCounter({
      name: 'z_router_both_ways_total',
      help: 'Слой источника Ф3 — confidence-gated both-ways в retrieval: triggered="yes" запущены структурный И семантический маршруты параллельно (RRF), "no" только семантика (уверенный topic/fact).',
      labelNames: ['triggered'] as const,
    });

    this.taskAssigneeAmbiguousTotal = this.getOrCreateCounter({
      name: 'z_task_assignee_ambiguous_total',
      help: 'Резолвер исполнителя задачи (ТЗ 2026-05-25 hard-participant-identification) не смог однозначно сопоставить assigneeRaw с участником встречи. reason="duplicate_name" — ≥2 участников с тем же display name; "llm_hallucination" — LLM вернул userId, которого нет в списке participants.',
      labelNames: ['tenant', 'reason'] as const,
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
    // KC-Temporal W1.1 — «открытые» (validUntil IS NULL) IdeaBlock'и по signal_type.
    this.kcFactsOpenGauge = this.getOrCreateGauge({
      name: 'kc_facts_open_gauge',
      help: 'Открытые (validUntil IS NULL) канонические IdeaBlock\'и по signal_type. KC-Temporal W1.1.',
      labelNames: ['tenant', 'signal_type'] as const,
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
    this.llmBudgetExceededTotal = this.getOrCreateCounter({
      name: 'llm_budget_exceeded_total',
      help: 'LLM-вызов при превышенном hard-cap бюджета; mode=observe (не блокировали) | enforce (заблокировали).',
      labelNames: ['mode'] as const,
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

    // ── meeting report fast (ТЗ 2026-05-25) ───────────────────────────
    this.meetingReportFastTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_fast_total',
      help: 'meeting-report-fast: количество запусков воркера по tenant × status (ready|failed|partial).',
      labelNames: ['tenant', 'status'] as const,
    });
    this.meetingReportFastDurationSeconds = this.getOrCreateHistogram({
      name: 'z_meeting_report_fast_duration_seconds',
      help: 'meeting-report-fast: длительность одного запуска воркера (секунды). p50/p95 через histogram_quantile.',
      labelNames: [] as const,
      // Целевая latency по ТЗ — ~2 минуты. Bucket'ы перекрывают «зелёную»
      // зону (< 60s), целевую (60-180s) и «красную» (> 300s).
      buckets: [5, 15, 30, 60, 90, 120, 180, 300, 600],
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

    // ── TZ-1 Фаза 0 (daily-value-engine) — дневной бюджет + кампания привязки ──
    this.notificationBudgetConsumedTotal = this.getOrCreateCounter({
      name: 'notification_budget_consumed_total',
      help: 'TZ-1 Ф0 — потрачено единиц дневного бюджета push-уведомлений (по trigger=eventType).',
      labelNames: ['trigger'] as const,
    });
    this.notificationBudgetBlockedTotal = this.getOrCreateCounter({
      name: 'notification_budget_blocked_total',
      help: 'TZ-1 Ф0 — push-доставка заблокирована (reason ∈ budget_exceeded|quiet_hours|opted_out); in_app всё равно доставлен.',
      labelNames: ['reason'] as const,
    });
    this.notificationDeferredToDigestTotal = this.getOrCreateCounter({
      name: 'notification_deferred_to_digest_total',
      help: 'TZ-1 Ф0 — сколько push-уведомлений отложено (бюджет/тихие часы/opt-out). Кандидаты в дайджест.',
      labelNames: [] as const,
    });
    this.channelBindingCoverageRatio = this.getOrCreateGauge({
      name: 'channel_binding_coverage_ratio',
      help: 'TZ-1 Ф0 — доля сотрудников с verified Telegram-привязкой (0..1) по tenant_top.',
      labelNames: ['tenant_top'] as const,
    });
    this.channelBindingCampaignInvitedTotal = this.getOrCreateCounter({
      name: 'channel_binding_campaign_invited_total',
      help: 'TZ-1 Ф0 — отправлено приглашений/напоминаний привязать канал (кампания), по tenant_top.',
      labelNames: ['tenant_top'] as const,
    });
    this.checkinPromptDeliveredTotal = this.getOrCreateCounter({
      name: 'checkin_prompt_delivered_total',
      help: 'TZ-1 Ф0 — доставлен дневной чек-ин prompt по каналу (channel ∈ telegram_bot|max_bot|in_app|email_smtp).',
      labelNames: ['channel'] as const,
    });

    this.dayReportCollectedTotal = this.getOrCreateCounter({
      name: 'day_report_collected_total',
      help: 'Сколько (человек×день) дневных отчётов собрано сборщиком. tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });
    this.dayReportBlockDroppedNoPersonTotal = this.getOrCreateCounter({
      name: 'day_report_block_dropped_no_person_total',
      help: 'Сколько блоков отброшено сборщиком из-за отсутствия authorPersonId.',
      labelNames: [] as const,
    });
    this.dayReportNotDoneVerifyCallsTotal = this.getOrCreateCounter({
      name: 'day_report_not_done_verify_calls_total',
      help: 'Сколько вызовов LLM-проверщика закрытия сделал расчёт notDone.',
      labelNames: [] as const,
    });

    // ── TZ-1 Фаза 1 (daily-value-engine) — радар клиентов под риском ──
    this.customerRiskSnapshotsTotal = this.getOrCreateCounter({
      name: 'customer_risk_snapshots_total',
      help: 'TZ-1 Ф1 — построено снимков риска клиента (level ∈ critical|warning|ok).',
      labelNames: ['level'] as const,
    });
    this.customerRiskRadarFailedTotal = this.getOrCreateCounter({
      name: 'customer_risk_radar_failed_total',
      help: 'TZ-1 Ф1 — сбой радара клиентов (reason ∈ compute_failed|notify_failed).',
      labelNames: ['reason'] as const,
    });
    this.customerRiskManagerNotifiedTotal = this.getOrCreateCounter({
      name: 'customer_risk_manager_notified_total',
      help: 'TZ-1 Ф1 — отправлено push ответственному менеджеру по клиенту под риском.',
      labelNames: [] as const,
    });

    // ── ТЗ-2 Ф6.A (daily-value-dashboards) — здоровье портфеля целей ──
    this.portfolioHealthScore = this.getOrCreateGauge({
      name: 'portfolio_health_score',
      help: 'ТЗ-2 Ф6.A — интегральный балл здоровья портфеля целей (0..100) по tenant_top.',
      labelNames: ['tenant_top'] as const,
    });
    this.portfolioHealthSnapshotTotal = this.getOrCreateCounter({
      name: 'portfolio_health_snapshot_total',
      help: 'ТЗ-2 Ф6.A — построено недельных снимков здоровья портфеля (upsert).',
      labelNames: ['tenant_top'] as const,
    });
    this.portfolioPrioritySetTotal = this.getOrCreateCounter({
      name: 'portfolio_priority_set_total',
      help: 'ТЗ-2 Ф6.A — проставлен MoSCoW-приоритет цели (priority ∈ must|should|could|wont|none).',
      labelNames: ['tenant_top', 'priority'] as const,
    });

    // ── TZ-1 Фаза 2 (daily-value-engine) — движок рядового «Твой день» ──
    this.personalDailyBriefBuiltTotal = this.getOrCreateCounter({
      name: 'personal_daily_brief_built_total',
      help: 'TZ-1 Ф2 — построено персональных дневных брифов (upsert).',
      labelNames: [] as const,
    });
    this.personalDailyBriefDeliveredTotal = this.getOrCreateCounter({
      name: 'personal_daily_brief_delivered_total',
      help: 'TZ-1 Ф2 — доставлен персональный бриф по каналу (channel ∈ push|in_app|...).',
      labelNames: ['channel'] as const,
    });
    this.personalDailyBriefOpenedTotal = this.getOrCreateCounter({
      name: 'personal_daily_brief_opened_total',
      help: 'TZ-1 Ф2 — сотрудник открыл персональный бриф (POST /me/daily-brief/:id/opened).',
      labelNames: [] as const,
    });
    this.knowsWhoMatchTotal = this.getOrCreateCounter({
      name: 'knows_who_match_total',
      help: 'TZ-1 Ф2 — поиск носителя знания «кто знает X» (found ∈ yes|no).',
      labelNames: ['found'] as const,
    });

    // ── B6/Ф7 (mobile-cora-exec-manager §Ф7) — утренний exec web-push ──
    this.execMorningPushDeliveredTotal = this.getOrCreateCounter({
      name: 'z_exec_morning_push_delivered_total',
      help: 'B6/Ф7 — поставлен в очередь утренний exec web-push «Требует тебя сегодня» (channel=webpush).',
      labelNames: ['channel'] as const,
    });

    // ── TZ-1 Фаза 3.A/B/C (daily-value-engine) — агенты исполнения ──
    this.blockerSynthesisRecurringTotal = this.getOrCreateCounter({
      name: 'blocker_synthesis_recurring_total',
      help: 'TZ-1 Ф3.A — синтезированный кластер блокеров по статусу (status ∈ new|recurring|resolved).',
      labelNames: ['status'] as const,
    });
    this.taskClosureReopenRate = this.getOrCreateGauge({
      name: 'task_closure_reopen_rate',
      help: 'task-dedup Ф3 — доля accepted-кандидатов на закрытие, чья задача была переоткрыта (0..1) по tenant_top.',
      labelNames: ['tenant_top'] as const,
    });
    this.themeSilenceSurfacedTotal = this.getOrCreateCounter({
      name: 'theme_silence_surfaced_total',
      help: 'Редизайн Ф8.2 — surface риска «тема молчит N недель» (severity ∈ medium|high|critical), на создание Insight.',
      labelNames: ['severity'] as const,
    });
    this.promiseCascadeAlertTotal = this.getOrCreateCounter({
      name: 'promise_cascade_alert_total',
      help: 'TZ-1 Ф3.C — дневной алерт каскада обещаний (просроченное обещание держит чужую работу).',
      labelNames: [] as const,
    });

    // ── TZ-1 Фаза 4 (daily-value-engine) — улучшения и знания ──────
    this.ideasTopServedTotal = this.getOrCreateCounter({
      name: 'ideas_top_served_total',
      help: 'TZ-1 Ф4.A — отдача ленты идей (GET /ideas/top).',
      labelNames: [] as const,
    });
    this.ideaStatusAutoAdvancedTotal = this.getOrCreateCounter({
      name: 'idea_status_auto_advanced_total',
      help: 'TZ-1 Ф4.A — авто-продвижение статуса идеи при закрытии связанной задачи (label to = новый статус).',
      labelNames: ['to'] as const,
    });
    this.ideaStatusChangedNotifiedTotal = this.getOrCreateCounter({
      name: 'idea_status_changed_notified_total',
      help: 'TZ-1 Ф4.A — уведомление автору/supporter\'ам о смене статуса идеи доставлено.',
      labelNames: [] as const,
    });
    this.insightRecheckedTotal = this.getOrCreateCounter({
      name: 'insight_rechecked_total',
      help: 'TZ-1 Ф4.B — re-check митигированного инсайта (reactivated=true → вернулся в active).',
      labelNames: ['reactivated'] as const,
    });
    this.knowledgeAtRiskTotal = this.getOrCreateCounter({
      name: 'knowledge_at_risk_total',
      help: 'TZ-1 Ф4.C — снимок знание-под-риском по совмещённой серьёзности (severity ∈ critical|warning|ok).',
      labelNames: ['severity'] as const,
    });
    this.teamCapacityOverloadTotal = this.getOrCreateCounter({
      name: 'team_capacity_overload_total',
      help: 'TZ-1 Ф4.D — отдел помечен перегруженным агрегатом capacity.',
      labelNames: [] as const,
    });
    this.onboardingRampStalledTotal = this.getOrCreateCounter({
      name: 'onboarding_ramp_stalled_total',
      help: 'TZ-1 Ф4.E — новичок не активировался за окно онбординга (молчит).',
      labelNames: [] as const,
    });

    // ── TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap ──
    this.valueRecapBuiltTotal = this.getOrCreateCounter({
      name: 'value_recap_built_total',
      help: 'TZ-1 Ф5 — построено месячных снимков value-recap (upsert).',
      labelNames: [] as const,
    });
    this.valueRecapDeliveredTotal = this.getOrCreateCounter({
      name: 'value_recap_delivered_total',
      help: 'TZ-1 Ф5 — доставлен месячный value-recap владельцу/COO по каналу (channel ∈ push|in_app|...).',
      labelNames: ['channel'] as const,
    });
    this.valueRecapOpenedTotal = this.getOrCreateCounter({
      name: 'value_recap_opened_total',
      help: 'TZ-1 Ф5 — владелец открыл месячный value-recap (POST /value-recap/:id/opened).',
      labelNames: [] as const,
    });
    this.chatV2FeedbackTotal = this.getOrCreateCounter({
      name: 'chat_v2_feedback_total',
      help: 'TZ-1 Ф5 — поставлена оценка ответа AI-чата (reaction ∈ up|down).',
      labelNames: ['reaction'] as const,
    });
    this.chatV2AnsweredWithCitation = this.getOrCreateGauge({
      name: 'chat_v2_answered_with_citation_total',
      help: 'TZ-1 Ф5 — ответов AI-чата с привязкой к источнику (grounding-proxy, НЕ дефлекция) за окно (mode ∈ self|org).',
      labelNames: ['mode'] as const,
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
    // 2026-05-26 — транспорт через прокси telegram.crossmark.ru.
    // outcome ∈ ok | proxy_5xx | proxy_4xx | telegram_5xx | telegram_4xx |
    //           network. См. plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §1.1 п.6.
    this.telegramProxyRequestTotal = this.getOrCreateCounter({
      name: 'telegram_proxy_request_total',
      help: '2026-05-26 — Outbound-вызовы Bot API через прокси telegram.crossmark.ru. outcome = ok | proxy_5xx | proxy_4xx | telegram_5xx | telegram_4xx | network.',
      labelNames: ['api_method', 'outcome'] as const,
    });
    this.telegramProxyRequestDurationSeconds = this.getOrCreateHistogram({
      name: 'telegram_proxy_request_duration_seconds',
      help: '2026-05-26 — Длительность outbound-вызовов Bot API через прокси telegram.crossmark.ru (секунды, по api_method).',
      labelNames: ['api_method'] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    });
    this.telegramProxyHealthCheckTotal = this.getOrCreateCounter({
      name: 'telegram_proxy_health_check_total',
      help: '2026-05-26 — Результаты периодического health-check прокси telegram.crossmark.ru. outcome = ok | fail.',
      labelNames: ['outcome'] as const,
    });
    // β-9 (2026-05-25) — глобальный webhook без `:tenantId` в URL.
    // Идёт параллельно с старой `telegram_bot_webhook_received_total` для
    // переходного периода: операционная видит, какой путь сколько ловит.
    this.telegramBotGlobalWebhookReceivedTotal = this.getOrCreateCounter({
      name: 'telegram_bot_global_webhook_received_total',
      help: 'β-9 — Webhook Update от глобального Telegram-бота (без `:tenantId` в URL). type = message/edited_message/unknown.',
      labelNames: ['type'] as const,
    });
    // β-9 (2026-05-25) — пришёл `from.id` отправителя, для которого мы
    // не смогли найти ни активного `ChannelBinding`, ни `Membership` (=>
    // невозможно определить, в какой Org адресовать сообщение).
    // reason ∈ no_binding (binding не найден) | no_membership (binding
    // есть, но у user нет Membership).
    this.telegramBotUnknownSenderTotal = this.getOrCreateCounter({
      name: 'telegram_bot_unknown_sender_total',
      help: 'β-9 — Входящие в глобальный Telegram-бот от незнакомых отправителей. reason: no_binding | no_membership.',
      labelNames: ['reason'] as const,
    });
    // β-9 Phase 4 — действия главного администратора Z в админке над
    // глобальным Telegram-ботом. action ∈ token_changed | webhook_reset |
    // status_toggled | templates_updated | settings_read | bindings_read.
    this.adminTelegramBotActionsTotal = this.getOrCreateCounter({
      name: 'admin_telegram_bot_actions_total',
      help: 'β-9 Phase 4 — действия super-admin в админке над глобальным Telegram-ботом. action ∈ token_changed | webhook_reset | status_toggled | templates_updated | settings_read | bindings_read.',
      labelNames: ['action'] as const,
    });
    // β-9 Phase 6 — команда `/login` в Telegram-боте. Бот выдаёт
    // одноразовую magic-link на 15 минут для входа в веб-кабинет.
    // outcome ∈ ok (ссылка выдана) | not_linked (отправитель не привязан) |
    //           user_not_found (binding есть, но user удалён).
    this.botLoginCommandTotal = this.getOrCreateCounter({
      name: 'bot_login_command_total',
      help: 'β-9 Phase 6 — команда /login в Telegram-боте. outcome = ok|not_linked|user_not_found.',
      labelNames: ['outcome'] as const,
    });

    // ── invitations + magic-link (β-9, 2026-05-25) ─────────────────
    this.inviteCreatedTotal = this.getOrCreateCounter({
      name: 'invite_created_total',
      help: 'β-9 — Создание приглашения сотрудника. has_email = true|false.',
      labelNames: ['has_email'] as const,
    });
    this.inviteAcceptedTotal = this.getOrCreateCounter({
      name: 'invite_accepted_total',
      help: 'β-9 — Принятие приглашения. path = magic_link|password|telegram_first.',
      labelNames: ['path'] as const,
    });
    this.inviteReminderSentTotal = this.getOrCreateCounter({
      name: 'invite_reminder_sent_total',
      help: 'β-9 — Cron-напоминание. day = 7 (сотруднику) | 14 (директору).',
      labelNames: ['day'] as const,
    });
    this.inviteExpiredTotal = this.getOrCreateCounter({
      name: 'invite_expired_total',
      help: 'β-9 — Приглашение истекло без принятия.',
      labelNames: [] as const,
    });
    this.magicLinkRequestTotal = this.getOrCreateCounter({
      name: 'magic_link_request_total',
      help: 'β-9 — Запрос magic-link. outcome = sent|rate_limited|user_not_found.',
      labelNames: ['outcome'] as const,
    });
    this.magicLinkConsumeTotal = this.getOrCreateCounter({
      name: 'magic_link_consume_total',
      help: 'β-9 — Прожиг magic-link. outcome = ok|expired|already_used|invalid.',
      labelNames: ['outcome'] as const,
    });
    this.mustChangePasswordBlockTotal = this.getOrCreateCounter({
      name: 'auth_must_change_password_block_total',
      help:
        'audit Б2 — глобальный MustChangePasswordGuard отверг запрос ' +
        'пользователя с mustChangePassword=true вне whitelist. ' +
        'Размечается по path (для группировки в Grafana).',
      labelNames: ['path'] as const,
    });
    this.tochkaWebhookReplayTotal = this.getOrCreateCounter({
      name: 'tochka_webhook_replay_total',
      help:
        'audit Б4 — webhook от Точки отвергнут на этапе verify (replay/' +
        'expired/signature). reason = expired|not_before|signature|missing_iat|other.',
      labelNames: ['reason'] as const,
    });
    this.referralSelfReferralDeniedTotal = this.getOrCreateCounter({
      name: 'referral_self_referral_denied_total',
      help:
        'audit Б6 — попытка self-referral (Referral.ownerUserId совпал с ' +
        'member/owner целевой Org) отклонена.',
      labelNames: [] as const,
    });
    this.referralAttributionFirstTouchLockedTotal = this.getOrCreateCounter({
      name: 'referral_attribution_first_touch_locked_total',
      help:
        'commercial-reliability pack (2026-05-30) — повторный клик по другой ' +
        'реферальной ссылке отброшен first-touch гардом (Org.pendingAttributionSlug IS NOT NULL).',
      labelNames: [] as const,
    });
    this.participantRenamedTotal = this.getOrCreateCounter({
      name: 'participant_renamed_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 3) — хост переименовал ' +
        'гостя встречи (Participant.isRegisteredUser=false).',
      labelNames: [] as const,
    });
    this.billingInvoiceCreatedTotal = this.getOrCreateCounter({
      name: 'billing_invoice_created_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — Invoice создан. ' +
        'kind: acquiring|bank|manual. tenant_top через tenantTopOf.',
      labelNames: ['tenant_top', 'kind'] as const,
    });
    this.billingInvoicePaidTotal = this.getOrCreateCounter({
      name: 'billing_invoice_paid_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — Invoice оплачен ' +
        '(status=paid). kind: acquiring|bank|manual. tenant_top через tenantTopOf.',
      labelNames: ['tenant_top', 'kind'] as const,
    });
    this.billingSubscriptionRenewedTotal = this.getOrCreateCounter({
      name: 'billing_subscription_renewed_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — Subscription ' +
        'продлена при оплате очередного invoice. tier: free|pro|business|enterprise.',
      labelNames: ['tenant_top', 'tier'] as const,
    });
    this.billingSubscriptionCancelledTotal = this.getOrCreateCounter({
      name: 'billing_subscription_cancelled_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — Subscription ' +
        'отменена. reason: user_cancelled|payment_failed|manual_admin.',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.billingWebhookReceivedTotal = this.getOrCreateCounter({
      name: 'billing_webhook_received_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — входящий webhook ' +
        'от платёжного провайдера. provider=tochka. status: ok|sig_fail|replay|invalid_payload.',
      labelNames: ['provider', 'status'] as const,
    });
    this.billingProviderRequestDurationSeconds = this.getOrCreateHistogram({
      name: 'billing_provider_request_duration_seconds',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — длительность исходящего ' +
        'HTTP-запроса в платёжного провайдера (Точка). method=create_invoice|verify_webhook|...',
      labelNames: ['provider', 'method', 'status'] as const,
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    });
    this.referralClickTotal = this.getOrCreateCounter({
      name: 'referral_click_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — реферальный клик ' +
        '(beacon POST /public/referrals/attribution). partner_top через tenantTopOf(slug).',
      labelNames: ['partner_top'] as const,
    });
    this.referralSignupTotal = this.getOrCreateCounter({
      name: 'referral_signup_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — Org атрибутирована ' +
        'к рефералу (первая first-touch запись). partner_top через tenantTopOf(slug).',
      labelNames: ['partner_top'] as const,
    });
    this.referralPayoutCreatedTotal = this.getOrCreateCounter({
      name: 'referral_payout_created_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — ReferralPayout(pending) ' +
        'создан cron-ом 10-го числа. cron_run_date=YYYY-MM-DD UTC.',
      labelNames: ['cron_run_date'] as const,
    });
    this.referralPayoutAmountRubTotal = this.getOrCreateCounter({
      name: 'referral_payout_amount_rub_total',
      help:
        'commercial-reliability pack (2026-05-30, Фаза 4) — суммарный объём ' +
        'partner-выплат в рублях (amountKopecks/100). Без лейблов — общий counter.',
      labelNames: [] as const,
    });
    this.referralPromoImpressionTotal = this.getOrCreateCounter({
      name: 'referral_promo_impression_total',
      help:
        'referrals-cabinet-revamp §8.3a (2026-05-31) — первый показ промо-полосы ' +
        'ReferralPromoStrip в AppShell за сессию пользователя. Не на каждый ререндер. ' +
        'role ∈ owner | member.',
      labelNames: ['role'] as const,
    });
    this.referralPromoClickTotal = this.getOrCreateCounter({
      name: 'referral_promo_click_total',
      help:
        'referrals-cabinet-revamp §8.3a (2026-05-31) — клик «Получить ссылку» в ' +
        'промо-полосе ReferralPromoStrip. role ∈ owner | member.',
      labelNames: ['role'] as const,
    });
    this.referralPromoDismissedTotal = this.getOrCreateCounter({
      name: 'referral_promo_dismissed_total',
      help:
        'referrals-cabinet-revamp §8.3a (2026-05-31) — клик «×» (закрыть) в ' +
        'промо-полосе ReferralPromoStrip. role ∈ owner | member.',
      labelNames: ['role'] as const,
    });
    this.billingEmitFailedTotal = this.getOrCreateCounter({
      name: 'billing_emit_failed_total',
      help:
        'audit С3 — BillingService.safeEmit() поймал ошибку listener\'а ' +
        '(side-effect: реф-комиссия, signup-бонус, ...). Лейбл event = ' +
        'BillingEvent name (invoice.paid, invoice.bonus, ...).',
      labelNames: ['event'] as const,
    });
    this.conciergeConfigErrorTotal = this.getOrCreateCounter({
      name: 'concierge_config_error_total',
      help:
        'audit С23 — concierge не смог прочитать config (cfg.concierge.* ' +
        'недоступен). Не блокирует запрос, но > 0 означает баг конфига.',
      labelNames: ['reason'] as const,
    });
    this.referralInnMismatchTotal = this.getOrCreateCounter({
      name: 'referral_inn_mismatch_total',
      help:
        'audit Б6 — verifyInn отвергнут из-за несовпадения. ' +
        'reason = lookup_inn_mismatch | director_name_mismatch.',
      labelNames: ['reason'] as const,
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

    // ── zero-button bot inbound (SBA β-1 rip-out, 2026-05-23) ──────
    this.botInboundTotal = this.getOrCreateCounter({
      name: 'bot_inbound_total',
      help: 'SBA β-1 zero-button — нормализованный inbound в Telegram/MAX-боты (kind: text/voice/document/start_command/link_code/other).',
      labelNames: ['channel', 'kind'] as const,
    });
    this.botVoiceAsrDurationSeconds = this.getOrCreateHistogram({
      name: 'bot_voice_asr_duration_seconds',
      help: 'SBA β-1 zero-button — длительность ASR voice-сообщения от бота (Vox submit+poll, секунды).',
      labelNames: ['channel'] as const,
      buckets: [1, 3, 5, 10, 20, 40, 60, 120, 300],
    });
    this.botIntentClassifiedTotal = this.getOrCreateCounter({
      name: 'bot_intent_classified_total',
      help: 'SBA β-1 zero-button — результат intent-классификации входящего текста/voice (intent: chat_query/free_note; source: llm/heuristic).',
      labelNames: ['channel', 'intent', 'source'] as const,
    });
    // ТЗ 2026-05-29 telegram-self-initiated-checkins — distinct-метрика
    // для plan/report (kind=morning/evening) с разделением источника
    // (llm / fallback_heuristic / fallback_factual_at_llm_fail).
    this.botCheckinIntentClassifierTotal = this.getOrCreateCounter({
      name: 'z_bot_checkin_intent_classifier_total',
      help: 'ТЗ 2026-05-29 telegram-self-initiated-checkins — распознавание plan/report в bot-адаптере (kind: morning/evening; source: llm/fallback_heuristic/fallback_factual_at_llm_fail).',
      labelNames: ['channel', 'kind', 'source'] as const,
    });
    // ТЗ 2026-05-29 telegram-self-initiated-checkins — outcome обработки
    // self-initiated daily_checkin_self в CheckinResponseHandler.
    this.botDailyCheckinSelfTotal = this.getOrCreateCounter({
      name: 'z_bot_daily_checkin_self_total',
      help: 'ТЗ 2026-05-29 telegram-self-initiated-checkins — outcome обработки self-initiated daily_checkin_self (saved/low_parser_confidence_curator_review/no_person/no_membership/error).',
      labelNames: ['channel', 'kind', 'outcome'] as const,
    });

    // ── tracker Phase 4 РФ — Telegram-бот для задач (Wave 3, 2026-05-24) ──
    this.telegramTasksCreatedTotal = this.getOrCreateCounter({
      name: 'telegram_tasks_created_total',
      help: 'Tracker Phase 4 РФ — задачи, созданные через Telegram-бот (IntakeIssue → Issue). status: created (intake) | auto_created (intake + auto-triage) | failed | intake_only.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.telegramVoiceTranscribedTotal = this.getOrCreateCounter({
      name: 'telegram_voice_transcribed_total',
      help: 'Tracker Phase 4 РФ — voice-сообщения боту, успешно транскрибированные. kind: create_task | forward_to_task.',
      labelNames: ['tenant_top', 'kind'] as const,
    });
    this.telegramForwardsTotal = this.getOrCreateCounter({
      name: 'telegram_forwards_total',
      help: 'Tracker Phase 4 РФ — forward в бот → IntakeIssue. status: created | failed | intake_only.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.telegramDigestSentTotal = this.getOrCreateCounter({
      name: 'telegram_digest_sent_total',
      help: 'Tracker Phase 4 РФ — утренний дайджест задач, отправленный в Telegram. result: sent | empty | dedup_skip | error.',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.pendingReminderSentTotal = this.getOrCreateCounter({
      name: 'pending_reminder_sent_total',
      help: 'Action Center B3 — повторяющееся Telegram-напоминание о pending-подтверждениях. result: sent | empty | dedup | error.',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.telegramReplyClassifiedTotal = this.getOrCreateCounter({
      name: 'telegram_reply_classified_total',
      help: 'Tracker Phase 4 РФ — reply на bot-уведомление классифицирован. kind: status_command | comment | new_task | unknown.',
      labelNames: ['tenant_top', 'kind'] as const,
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
    // ── Action Center B5 «оживление expiresAt» (2026-06-02) ──
    this.curationItemExpiredTotal = this.getOrCreateCounter({
      name: 'curation_item_expired_total',
      help: 'Action Center B5 — CurationItemLifecycleCron: pending CurationItem закрыт по истечении expiresAt (resource_type).',
      labelNames: ['resource_type'] as const,
    });
    this.curationItemAgeSeconds = this.getOrCreateHistogram({
      name: 'curation_item_age_seconds',
      help: 'Action Center B5 — возраст CurationItem от createdAt до истечения (секунды, по level).',
      labelNames: ['level'] as const,
      buckets: [3600, 14_400, 86_400, 259_200, 604_800, 1_209_600, 2_592_000],
    });
    // ── Action Center A1 «лестница доверия» (2026-06-02) ──
    this.curationProvisionalTotal = this.getOrCreateCounter({
      name: 'curation_provisional_total',
      help: 'A1 — критические карточки, провизорно канонизированные AI-судьёй (trustTier=provisional, минуя человека), по resource_type.',
      labelNames: ['resource_type'] as const,
    });
    this.curationAuditSampleTotal = this.getOrCreateCounter({
      name: 'curation_audit_sample_total',
      help: 'A1 — авто/провизорные решения, попавшие в аудит-выборку (создан лёгкий аудит-CurationItem), по resource_type.',
      labelNames: ['resource_type'] as const,
    });
    this.curationVerifierVerdictTotal = this.getOrCreateCounter({
      name: 'curation_verifier_verdict_total',
      help: 'A1 — вердикты AI-судьи canonical-verify (decision ∈ accept|reject|split_uncertain|unavailable × consensus_type).',
      labelNames: ['decision', 'consensus_type'] as const,
    });
    this.curationGrayZoneJudgedTotal = this.getOrCreateCounter({
      name: 'curation_gray_zone_judged_total',
      help: 'A-Ф5 — некритичные карточки серой зоны, прогнанные через AI-судью (outcome ∈ canonicalized|to_human).',
      labelNames: ['outcome'] as const,
    });
    // ── Autonomy W1 (2026-06-12) — Conflict-Arbiter (LLM-арбитр конфликтов) ──
    this.conflictArbiterTotal = this.getOrCreateCounter({
      name: 'z_conflict_arbiter_total',
      help: 'Autonomy W1 — исходы ночного LLM-арбитра конфликтов знаний (ConflictArbiterCron): verdict дебата × outcome ∈ auto_resolved|left_open|error.',
      labelNames: ['verdict', 'outcome'] as const,
    });
    // ── Action Center A2 «лестница доверия» (2026-06-02) ──
    this.curationKillSwitchTotal = this.getOrCreateCounter({
      name: 'curation_kill_switch_total',
      help: 'A2 — срабатывание kill-switch: провизорный путь для типа отключён (provisionalThresholdByType=1.01) из-за высокого процента ошибок аудита, по resource_type.',
      labelNames: ['resource_type'] as const,
    });
    this.curationAutotuneAdjustmentTotal = this.getOrCreateCounter({
      name: 'curation_autotune_adjustment_total',
      help: 'A2 — авто-подстройка autoThresholdByType по override-rate (resource_type × direction ∈ up|down).',
      labelNames: ['resource_type', 'direction'] as const,
    });

    // ── curation wave 2 (SBA α-4 wave 2) — CompletenessSlot + ConsistencyChecker
    this.completenessSlotsOpenTotal = this.getOrCreateGauge({
      name: 'completeness_slots_open_total',
      help: 'SBA α-4 wave 2 — сколько CompletenessSlot.filledAt IS NULL сейчас (card_type ∈ regulation|process|role|company_profile).',
      labelNames: ['card_type'] as const,
    });
    this.completenessSlotsFilledTotal = this.getOrCreateCounter({
      name: 'completeness_slots_filled_total',
      help: 'SBA α-4 wave 2 — сколько слотов было закрыто (auto-scanner либо manual mark-filled), counter.',
      labelNames: ['card_type'] as const,
    });
    this.consistencyViolationsTotal = this.getOrCreateCounter({
      name: 'consistency_violations_total',
      help: 'SBA α-4 wave 2 — сколько структурных нарушений детектировано ConsistencyCheckerCron (rule ∈ R1..R6).',
      labelNames: ['rule'] as const,
    });
    this.consistencyCheckerDurationSeconds = this.getOrCreateHistogram({
      name: 'consistency_checker_duration_seconds',
      help: 'SBA α-4 wave 2 — длительность одного прохода ConsistencyCheckerCron в секундах.',
      labelNames: [] as const,
      buckets: [0.5, 1, 5, 15, 60, 300, 900],
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
    this.corePartialLossTotal = this.getOrCreateCounter({
      name: 'core_partial_loss_total',
      help: 'block-ingest: частичная/полная потеря блоков (reason). reason: extraction_window_failed | persist_null',
      labelNames: ['reason'] as const,
    });
    this.strategicAlignmentParseSkipTotal = this.getOrCreateCounter({
      name: 'strategic_alignment_parse_skip_total',
      help: 'strategic-alignment.worker: ответ LLM не разобран → graceful skip (job НЕ падает). reason: empty | invalid_json | schema_mismatch',
      labelNames: ['reason'] as const,
    });
    this.rawEventRecoveryReenqueuedTotal = this.getOrCreateCounter({
      name: 'raw_event_recovery_reenqueued_total',
      help: 'raw-event-recovery.cron: RawEvent застрял в processingStatus=received и повторно поставлен в block-ingest.',
    });
    this.rawEventRecoveryDeadLetteredTotal = this.getOrCreateCounter({
      name: 'raw_event_recovery_dead_lettered_total',
      help: 'raw-event-recovery.cron: RawEvent старше maxAge всё ещё в processingStatus=received → dead-letter алерт (НЕ реэнкьюим).',
    });
    this.blockWithoutEvidenceTotal = this.getOrCreateCounter({
      name: 'kc_block_without_evidence_total',
      help: 'block-ingest: блок отброшен провенанс-инвариантом (нет непустой evidence-цитаты). reason: empty_quote',
      labelNames: ['reason'] as const,
    });
    this.riskEdgeTotal = this.getOrCreateCounter({
      name: 'kc_risk_edge_total',
      help: 'block-linker/fact-supersede: рискованные связи (contradicts/supersedes/causes). outcome: created | rejected_low_conf | rejected_skeptic',
      labelNames: ['relation', 'outcome'] as const,
    });
    this.ragAbstainTotal = this.getOrCreateCounter({
      name: 'rag_abstain_total',
      help: 'Гейт честности RAG: ответ не заземлён блоками → честный отказ. mode: on (отказ применён) | shadow (только наблюдение over-abstention)',
      labelNames: ['mode'] as const,
    });
    // Ф3 МТЗ «разблокировка конвейера» (баг #18) — skip-return'ы хендлеров.
    this.coreSpecialistSkippedTotal = this.getOrCreateCounter({
      name: 'core_specialist_skipped_total',
      help: 'Ф3 МТЗ — ранние skip-return хендлеров специалистов Слоя 3 (specialist × reason). reason: block_not_found / tenant_mismatch / not_canonical / signal_out_of_scope. До этого skip был неотличим от success.',
      labelNames: ['specialist', 'reason'] as const,
    });
    this.regulationScopeRoleUnresolvedTotal = this.getOrCreateCounter({
      name: 'regulation_scope_role_unresolved_total',
      help: 'Combo-извлечение: scope=role:<имя> не разрешился в Role.id (роль ещё не создана) — записан сырой scope, перерезолвится backfill-ом после создания роли.',
      labelNames: ['tenant'] as const,
    });
    this.regulationOwnerHintUnresolvedTotal = this.getOrCreateCounter({
      name: 'regulation_owner_hint_unresolved_total',
      help: 'Combo-извлечение: ownerHint не разрешился в Person.id (нет персоны / тёзки fail-closed) — ownerPersonId не проставлен.',
      labelNames: ['tenant'] as const,
    });
    // Ф5 МТЗ «разблокировка конвейера» — провалы типизированных сущностей
    // группы Б в block-ingest (по type × reason).
    this.kcTypedEntityFailedTotal = this.getOrCreateCounter({
      name: 'kc_typed_entity_failed_total',
      help: 'Ф5 МТЗ — провалы записи типизированной сущности группы Б в block-ingest (type × reason). type: process/regulation/policy/tool/metric/decision. reason: age_unavailable (системный отказ графа) / validation_error / idempotent_skip (P2002 гонка — норма) / other. age_unavailable блокирует пометку RawEvent ingested → failed+ретрай.',
      labelNames: ['type', 'reason'] as const,
    });
    // Ф1 (knowledge-access) — субъект-атрибуция автора знания по источнику identity.
    this.kcSubjectAttributionTotal = this.getOrCreateCounter({
      name: 'kc_subject_attribution_total',
      help: 'Ф1 (knowledge-access) — детерминированная subject-атрибуция автора знания по источнику identity. via: participant (speakerParticipantId) / userId / personId / email / name (fuzzy) / none (автор не определён).',
      labelNames: ['via'] as const,
    });
    // Ф4 (knowledge-access) — гейт доступа к знаниям (shadow / enforce).
    this.kcAccessShadowDiffTotal = this.getOrCreateCounter({
      name: 'kc_access_shadow_diff_total',
      help: 'Ф4 knowledge-access — в shadow-режиме: сколько блоков было бы отфильтровано гейтом доступа (по поверхности). Сверка перед переводом в enforce.',
      labelNames: ['surface'] as const,
    });
    this.kcAccessDeniedTotal = this.getOrCreateCounter({
      name: 'kc_access_denied_total',
      help: 'Ф4 knowledge-access — в enforce-режиме: сколько блоков исключено гейтом доступа (по поверхности).',
      labelNames: ['surface'] as const,
    });
    // Agent-chain overhaul Фаза 0a (2026-06-07) — расхождение материализации графа.
    this.kcMaterializationGapTotal = this.getOrCreateCounter({
      name: 'kc_materialization_gap_total',
      help: 'knowledge-core — встречи, где блоки с signalType (decision/idea) есть, а соответствующая запись (Decision/Idea) не материализовалась (type).',
      labelNames: ['type'] as const,
    });
    // Agent-chain overhaul Фаза 4.2 (2026-06-07) — авто-привязка Goal↔Theme.
    this.goalThemeAutolinkTotal = this.getOrCreateCounter({
      name: 'goal_theme_autolink_total',
      help: 'knowledge-core — детерминированные авто-привязки Goal↔Theme (GoalTheme source=ai). method: provenance (блоки-источники цели уже в теме) | comention (тема упоминает те же сущности).',
      labelNames: ['method'] as const,
    });
    // Agent-chain overhaul Фаза 4.1 (2026-06-08) — LLM-привязка задач↔цели.
    this.goalTaskLinkTotal = this.getOrCreateCounter({
      name: 'z_goal_task_link_total',
      help: 'knowledge-core — LLM-привязка задач встречи к AI-цели (goal-task-link, DEFAULT OFF). result: linked (Issue.goalId проставлен) | rejected (develops=false / низкий confidence / уже привязана) | fallback (арбитр провалился) | skipped.',
      labelNames: ['result'] as const,
    });
    // Ф7 МТЗ «разблокировка конвейера» (баг #1/#8) — провалы моста ingestMeeting.
    this.meetingIngestFailedTotal = this.getOrCreateCounter({
      name: 'meeting_ingest_failed_total',
      help: 'Ф7 МТЗ — провалы моста встреча→knowledge-core (analyze.worker → MeetingIngestAdapter.ingestMeeting). reason: source_inactive / no_merged_transcript / without_tenant / quota_exceeded / other. Раньше провал глушился в resolved-null (встреча выглядела «зелёной», RawEvent не создавался). Теперь reject виден через failureReason + ретрай-cron meeting-reingest.',
      labelNames: ['reason'] as const,
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

    // Goals OKR v2 Фаза 3 (2026-06-02) — авто-прогресс KR.
    this.goalKrAutoprogressTotal = this.getOrCreateCounter({
      name: 'goal_kr_autoprogress_total',
      help: 'Goals OKR v2 Фаза 3 — попытки авто-пересчёта GoalKeyResult.currentValue cron\'ом (source_kind × status). status: ok|unchanged|skipped|error.',
      labelNames: ['source_kind', 'status'] as const,
    });

    // Goals OKR v2 Фаза 4 (2026-06-02) — еженедельный пульс целей.
    this.goalsPulseGeneratedTotal = this.getOrCreateCounter({
      name: 'goals_pulse_generated_total',
      help: 'Goals OKR v2 Фаза 4 — успешно сгенерированный еженедельный пульс целей.',
      labelNames: ['tenant_top'] as const,
    });
    this.goalsPulseFailedTotal = this.getOrCreateCounter({
      name: 'goals_pulse_failed_total',
      help: 'Goals OKR v2 Фаза 4 — провал пульса целей (reason ∈ llm_failed|notify_failed|exception).',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.goalsPulseDeliveredTotal = this.getOrCreateCounter({
      name: 'goals_pulse_delivered_total',
      help: 'Goals OKR v2 Фаза 4 — счётчик удачных доставок пульса целей (channel ∈ conversational).',
      labelNames: ['tenant_top', 'channel'] as const,
    });

    // Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges.
    this.temporalEdgesInvalidatedTotal = this.getOrCreateCounter({
      name: 'temporal_edges_invalidated_total',
      help: 'Agents v2 Фаза A1 — сколько existing open-links (block↔block + entity↔entity) было закрыто TemporalConflictService при детектировании противоречащей новой связи (validUntil=NOW). relationType — закрытого link\'а.',
      labelNames: ['relationType'] as const,
    });
    this.temporalFilterHitsTotal = this.getOrCreateCounter({
      name: 'temporal_filter_hits_total',
      help: 'Agents v2 Фаза A1 — каждый edge, обработанный bi-temporal retrieval-фильтром. passed = валиден на момент validAt; filtered_out = отсеян.',
      labelNames: ['result'] as const,
    });
    this.edgesWithTemporalTotal = this.getOrCreateGauge({
      name: 'edges_with_temporal_total',
      help: 'Agents v2 Фаза A1 — gauge: сколько edges (block|entity) имеют непустые bi-temporal поля. Обновляется ежечасным snapshot-cron\'ом.',
      labelNames: ['type'] as const,
    });

    // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate.
    this.debateJudgmentsTotal = this.getOrCreateCounter({
      name: 'z_debate_judgments_total',
      help: 'Agents v2 Фаза A2 — финальный verdict одного debate-run\'а (`new`/`merge`/`supersedes`/`split_uncertain`). consensus_type ∈ unanimous|majority|split.',
      labelNames: ['task_type', 'decision', 'consensus_type'] as const,
    });
    this.debateCostUsdTotal = this.getOrCreateCounter({
      name: 'z_debate_cost_usd_total',
      help: 'Agents v2 Фаза A2 — суммарный USD-cost всех debate-run\'ов (tenant_top × task_type). tenant_top — top-100 bucket через tenantTopOf, cardinality ≤ 101.',
      labelNames: ['tenant_top', 'task_type'] as const,
    });
    this.debateRound2TriggeredTotal = this.getOrCreateCounter({
      name: 'z_debate_round2_triggered_total',
      help: 'Agents v2 Фаза A2 — round 2 запущен при split-verdict\'е round 1.',
      labelNames: ['task_type'] as const,
    });
    this.debateProviderDisagreementTotal = this.getOrCreateCounter({
      name: 'z_debate_provider_disagreement_total',
      help: 'Agents v2 Фаза A2 — пара провайдеров, которые НЕ согласились в round 1 (разные verdict\'ы). provider_a/provider_b — лексикографически отсортированы для нормализации.',
      labelNames: ['provider_a', 'provider_b', 'task_type'] as const,
    });
    this.debateFallbackToSingleTotal = this.getOrCreateCounter({
      name: 'z_debate_fallback_to_single_total',
      help: 'Agents v2 Фаза A2 — debate сорвался, Specialist вернулся к одиночному LLM-вызову. reason ∈ cost_cap | provider_unavailable.',
      labelNames: ['reason'] as const,
    });
    this.voxOutcomeTotal = this.getOrCreateCounter({
      name: 'z_vox_outcome_total',
      help: 'vox F4 — исход транскрипции дорожки. outcome ∈ ok | empty | no_words. no_words = COMPLETED с текстом, но без пословных таймингов; empty = без слов и текста.',
      labelNames: ['outcome'] as const,
    });

    // KC-Temporal W1.2 — FactSupersedeService.
    this.kcFactSupersedeVerdictsTotal = this.getOrCreateCounter({
      name: 'kc_fact_supersede_verdicts_total',
      help: 'KC-Temporal W1.2 — verdicts FactSupersedeService.processNewBlock (unrelated|extends|contradicts|supersedes|skip_*).',
      labelNames: ['verdict'] as const,
    });
    this.kcFactSupersedeLatencyMs = this.getOrCreateHistogram({
      name: 'kc_fact_supersede_latency_ms',
      help: 'KC-Temporal W1.2 — длительность одного processNewBlock в миллисекундах (KNN + LLM + Prisma).',
      labelNames: [] as const,
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000],
    });

    // KC-Temporal W1.5 — EntityResolutionService ingest path.
    this.kcEntityResolvePathTotal = this.getOrCreateCounter({
      name: 'kc_entity_resolve_path_total',
      help: 'KC-Temporal W1.5 — каким путём отрезолвилась сущность в findOrCreateEntity (exact|knn|create|cache_hit).',
      labelNames: ['path'] as const,
    });
    this.kcEntityResolveLatencyMs = this.getOrCreateHistogram({
      name: 'kc_entity_resolve_latency_ms',
      help: 'KC-Temporal W1.5 — длительность одного findOrCreateEntity в миллисекундах.',
      labelNames: [] as const,
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
    });

    // KC-Temporal W3.5 — ProjectionRebuilderService.
    this.kcProjectionRebuildTotal = this.getOrCreateCounter({
      name: 'kc_projection_rebuild_total',
      help: 'KC-Temporal W3.5 — сколько rebuild-jobs было поставлено в очередь (type = decision|insight|idea|card|regulation|process|policy|skill_trait|process_template|experiment).',
      labelNames: ['type'] as const,
    });
    this.kcProjectionRebuildLagMs = this.getOrCreateHistogram({
      name: 'kc_projection_rebuild_lag_ms',
      help: 'KC-Temporal W3.5 — lag между событием `idea_block.updated` и enqueue rebuild-job\'а в миллисекундах (без учёта дебаунса BullMQ).',
      labelNames: [] as const,
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
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

    // ── SBA α-7 wave 2 — ProcessTemplate (Specialist 3.1 process-detector) ──
    this.processTemplatesTotal = this.getOrCreateGauge({
      name: 'process_templates_total',
      help: 'SBA α-7 wave 2 — число ProcessTemplate в каждой Org × status (tenant_top × status). tenant_top: top-100 + "other" для контроля cardinality.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.processTemplateCompletenessAvg = this.getOrCreateGauge({
      name: 'process_template_completeness_avg',
      help: 'SBA α-7 wave 2 — средний completeness активных ProcessTemplate в Org (0..1; tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.processDetectorExtractionsTotal = this.getOrCreateCounter({
      name: 'process_detector_extractions_total',
      help: 'SBA α-7 wave 2 — итог одного extract-батча process-detector (tenant_top × result). result: new | updated | skipped.',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.processTemplateExtractDurationSeconds = this.getOrCreateHistogram({
      name: 'process_template_extract_duration_seconds',
      help: 'SBA α-7 wave 2 — длительность одного LLM-extract-вызова process-template-extract (секунды).',
      labelNames: [] as const,
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    });

    // ── SBA γ-3 — Cross-Functional Process + Handoff Tracker ──
    this.crossFunctionalProcessesTotal = this.getOrCreateGauge({
      name: 'cross_functional_processes_total',
      help: 'SBA γ-3 — число cross-functional ProcessTemplate в Org (isCrossFunctional=true). tenant_top: top-100 buckets + "other".',
      labelNames: ['tenant_top'] as const,
    });
    this.crossFunctionalFrictionActiveTotal = this.getOrCreateGauge({
      name: 'cross_functional_friction_active_total',
      help: 'SBA γ-3 — число активных (resolvedAt=null) CrossFunctionalFrictionReport в Org × severity.',
      labelNames: ['tenant_top', 'severity'] as const,
    });
    this.crossFunctionalFrictionResolutionTimeSeconds = this.getOrCreateHistogram({
      name: 'cross_functional_friction_resolution_time_seconds',
      help: 'SBA γ-3 — время от created до resolved для CrossFunctionalFrictionReport (секунды).',
      labelNames: ['tenant_top'] as const,
      buckets: [3600, 86_400, 7 * 86_400, 30 * 86_400, 90 * 86_400, 180 * 86_400],
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
    this.probeClosedTotal = this.getOrCreateCounter({
      name: 'probe_closed_total',
      help: 'SBA β-5 (closing-loop) — сколько probe-уведомлений было закрыто ответом пользователя (tenant_top × source).',
      labelNames: ['tenant_top', 'source'] as const,
    });
    this.probeRecipientEngagementRate = this.getOrCreateGauge({
      name: 'probe_recipient_engagement_rate',
      help: 'SBA β-5 — отзывчивость получателя за 30 дней (отвечено / отправлено), per user.',
      labelNames: ['user_id'] as const,
    });
    // ── Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify ──
    this.probeResponseClassifiedTotal = this.getOrCreateCounter({
      name: 'probe_response_classified_total',
      help: 'Agents v2 Фаза 0.1 — сколько свободных ответов на probe классифицировано (confidence_bucket ∈ high|medium|low).',
      labelNames: ['confidence_bucket'] as const,
    });
    this.probeResponseUnclearTotal = this.getOrCreateCounter({
      name: 'probe_response_unclear_total',
      help: 'Agents v2 Фаза 0.1 — сколько ответов на probe признано непонятными (confidence < min). Метка original_reason — reason эмиттера, чтобы видеть, какие probe чаще получают «мусорный» ответ.',
      labelNames: ['original_reason'] as const,
    });
    // ── Probe Фаза 5 (2026-06-11) — исход probe для калибровки Фазы 2 ──
    this.probeOutcomeTotal = this.getOrCreateCounter({
      name: 'probe_outcome_total',
      help: 'Probe Фаза 5 — исход probe: answered (ответил) | ignored (истёк без ответа), по reason. Калибровочный сигнал для Фазы 2 (LLM-judge ценности вопроса).',
      labelNames: ['outcome', 'reason'] as const,
    });
    this.probeDialogTransitionTotal = this.getOrCreateCounter({
      name: 'probe_dialog_transition_total',
      help: 'Probe-clarify Ф6 — переход фазы диалогового уточнения (from → to).',
      labelNames: ['from', 'to'] as const,
    });
    this.probeDialogOutcomeTotal = this.getOrCreateCounter({
      name: 'probe_dialog_outcome_total',
      help: 'Probe-clarify Ф6 — терминальный исход диалога: applied | escalated_to_human | abandoned.',
      labelNames: ['outcome'] as const,
    });
    this.probeDialogDegradedTotal = this.getOrCreateCounter({
      name: 'probe_dialog_degraded_total',
      help: 'Probe-clarify Ф6 — откат к детерминированному one-shot из-за недоступности LLM-классификатора.',
      labelNames: ['reason'] as const,
    });
    // ── Probe Фаза 2 (2026-06-17) — LLM-судья качества формулировки вопроса ──
    this.probeQualityJudgedTotal = this.getOrCreateCounter({
      name: 'probe_quality_judged_total',
      help: 'Probe Фаза 2 — вердикт LLM-судьи качества формулировки probe-вопроса: ok (вопрос полноценный) | rewritten (взят регенерат судьи) | kept_on_fail (судья упал/невалидный rewrite → отправлен исходный).',
      labelNames: ['verdict'] as const,
    });
    // ── Probe Фаза 4 (2026-06-20) — LLM-гейт ценности probe-вопроса ──
    this.probeValueGateTotal = this.getOrCreateCounter({
      name: 'probe_value_gate_total',
      help: 'Probe Фаза 4 — вердикт LLM-гейта ценности probe-вопроса: ask (вопрос стоит задать) | skip (пробел пустой → не беспокоим человека).',
      labelNames: ['verdict'] as const,
    });
    this.subjectMemoryRuleExtractedTotal = this.getOrCreateCounter({
      name: 'subject_memory_rule_extracted_total',
      help: 'Слой выученной памяти: выведено правил по виду (kind).',
      labelNames: ['kind'] as const,
    });
    this.taskAssigneeClarifyTotal = this.getOrCreateCounter({
      name: 'task_assignee_clarify_total',
      help: 'Дозапрос исполнителя/срока задачи: исход по outcome.',
      labelNames: ['outcome'] as const,
    });
    this.companySummaryCompileTotal = this.getOrCreateCounter({
      name: 'company_summary_compile_total',
      help: 'Авто-профиль компании: проход компилятора summary по тенанту (result): compiled | pinned | skipped_pinned | skipped_fresh | skipped_cold_start | error.',
      labelNames: ['result'] as const,
    });
    this.routingSuggestionTotal = this.getOrCreateCounter({
      name: 'routing_suggestion_total',
      help: 'Маршрутизация по скиллам: выдано предложение исполнителя по способу подбора (match_path).',
      labelNames: ['match_path'] as const,
    });
    this.routingSuggestionAcceptedTotal = this.getOrCreateCounter({
      name: 'routing_suggestion_accepted_total',
      help: 'Маршрутизация по скиллам: предложенный исполнитель принят человеком.',
      labelNames: [] as const,
    });
    this.routingNoCandidateTotal = this.getOrCreateCounter({
      name: 'routing_no_candidate_total',
      help: 'Маршрутизация по скиллам: подходящий исполнитель не найден (ни одного кандидата выше порога).',
      labelNames: [] as const,
    });
    this.taskSkillRoutingAssignedTotal = this.getOrCreateCounter({
      name: 'task_skill_routing_assigned_total',
      help: 'Авто-назначение исполнителя по навыкам (умный подбор) в авто-пути (path): meeting | intake.',
      labelNames: ['path'] as const,
    });
    this.companyCapsuleInjectedTotal = this.getOrCreateCounter({
      name: 'company_capsule_injected_total',
      help: 'Авто-профиль компании: краткое описание (capsule) подставлено в SYSTEM по поверхности (surface): chat_v2 | concierge.',
      labelNames: ['surface'] as const,
    });
    this.subjectMemoryProbeSuppressedTotal = this.getOrCreateCounter({
      name: 'subject_memory_probe_suppressed_total',
      help: 'Слой выученной памяти: probe подавлен выученным правилом (по причине reason).',
      labelNames: ['reason'] as const,
    });
    this.subjectMemoryRuleActivatedTotal = this.getOrCreateCounter({
      name: 'subject_memory_rule_activated_total',
      help: 'Слой выученной памяти: выученное правило активировано.',
      labelNames: [] as const,
    });
    this.subjectMemoryRuleRolledBackTotal = this.getOrCreateCounter({
      name: 'subject_memory_rule_rolled_back_total',
      help: 'Слой выученной памяти: выученное правило откатано (по причине cause).',
      labelNames: ['cause'] as const,
    });
    this.subjectMemoryApplyTotal = this.getOrCreateCounter({
      name: 'subject_memory_apply_total',
      help: 'Слой выученной памяти: применение правила (по статусу status).',
      labelNames: ['status'] as const,
    });
    this.subjectMemoryPendingSweptTotal = this.getOrCreateCounter({
      name: 'subject_memory_pending_swept_total',
      help: 'Слой выученной памяти: висящие дубли-probe погашены выводом/активацией правила (sweepPendingDuplicates).',
      labelNames: [] as const,
    });
    // ── W2 autonomy (2026-06-12) — OwnerResolver («лестница владельца») ──
    this.ownerResolutionTotal = this.getOrCreateCounter({
      name: 'z_owner_resolution_total',
      help: 'W2 autonomy — исход «лестницы владельца» для missing_owner: auto (Кора назначила сама) | ambiguous (вопрос-выбор) | none (некому, probe как раньше).',
      labelNames: ['outcome'] as const,
    });
    // ── Ф5/Ф6 assistant-channels (2026-06-12) — мост «каналы → помощник» ──
    this.assistantTurnTotal = this.getOrCreateCounter({
      name: 'z_assistant_turn_total',
      help: 'Ф5/Ф6 assistant-channels — исход одного хода помощника в канале (AssistantChannelBridge): ok | error | quota | confirm_hold (мутация отложена до текстового «да») | handler_error (внешний catch, ответ потерян).',
      labelNames: ['outcome'] as const,
    });

    // ── Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow) ──
    this.promptFeedbackTotal = this.getOrCreateCounter({
      name: 'z_prompt_feedback_total',
      help: 'Agents v2 Фаза B1 — каждая запись PromptFeedback: has_edit=false при создании (originalOutput только), has_edit=true при update (editedOutput пришёл).',
      labelNames: ['prompt_key', 'has_edit'] as const,
    });
    this.autoruleExtractedTotal = this.getOrCreateCounter({
      name: 'z_autorule_extracted_total',
      help: 'Agents v2 Фаза B1 — каждое новое PromptRule, созданное AutoRuleExtractorService (status=shadow).',
      labelNames: ['prompt_key', 'rule_type'] as const,
    });
    this.autoruleRulesTotal = this.getOrCreateGauge({
      name: 'z_autorule_rules_total',
      help: 'Agents v2 Фаза B1 — gauge: сколько правил по (prompt_key × status × source). Обновляется hourly snapshot-cron\'ом (Фаза C); в Фазе B заведён, но не обновляется.',
      labelNames: ['prompt_key', 'status', 'source'] as const,
    });
    this.autoruleOverriddenTotal = this.getOrCreateCounter({
      name: 'z_autorule_overridden_total',
      help: 'Agents v2 Фаза B1 — каждое нажатие admin\'ом «Заблокировать» (status=overridden_by_admin, sticky).',
      labelNames: ['prompt_key'] as const,
    });

    // ── Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer ──
    this.conciergePrmAgreementTotal = this.getOrCreateCounter({
      name: 'z_concierge_prm_agreement_total',
      help: 'Agents v2 Фаза B2 — каждый shadow-scored step: agreed=true если top-1 LLM совпал с top-1 PRM, agreed=false иначе.',
      labelNames: ['agreed'] as const,
    });
    this.conciergePrmLlmChoseRankTotal = this.getOrCreateCounter({
      name: 'z_concierge_prm_llm_chose_rank_total',
      help: 'Agents v2 Фаза B2 — распределение «насколько LLM согласен с PRM»: ранг LLM-выбора в PRM-сортировке (1=top, 2/3=ниже, other=>3).',
      labelNames: ['rank'] as const,
    });
    this.conciergePrmCostUsdTotal = this.getOrCreateCounter({
      name: 'z_concierge_prm_cost_usd_total',
      help: 'Agents v2 Фаза B2 — кумулятивная стоимость PRM-вызовов в USD (тенант-bucket).',
      labelNames: ['tenant_top'] as const,
    });
    this.conciergePrmScoreDistribution = this.getOrCreateHistogram({
      name: 'z_concierge_prm_score_distribution',
      help: 'Agents v2 Фаза B2 — распределение PRM-скоров кандидатов (0..1) по toolName.',
      labelNames: ['tool_name'] as const,
      buckets: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    });

    // ── Agents v2 Фаза C1 (2026-05-30) — PracticeSkill ─────────────────
    this.practiceSkillsTotal = this.getOrCreateGauge({
      name: 'z_practice_skills_total',
      help: 'Agents v2 Фаза C1 — gauge: сколько PracticeSkill по (tenant_top × scope × status).',
      labelNames: ['tenant_top', 'scope', 'status'] as const,
    });
    this.practiceSkillsExtractedTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_extracted_total',
      help: 'Agents v2 Фаза C1 — каждый новый PracticeSkill, созданный PracticeSkillExtractorService (status=shadow).',
      labelNames: ['scope'] as const,
    });
    this.practiceSkillsPromotedTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_promoted_total',
      help: 'Agents v2 Фаза C1 — каждое решение evaluator\'а перевести shadow → active.',
      labelNames: [] as const,
    });
    this.practiceSkillsArchivedTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_archived_total',
      help: 'Agents v2 Фаза C1 — каждое решение evaluator\'а перевести skill в archived (composite < baseline).',
      labelNames: [] as const,
    });
    this.practiceSkillsRunsTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_runs_total',
      help: 'Agents v2 Фаза C1 — каждое использование PracticeSkill в clone-respond (status=shadow|active).',
      labelNames: ['status'] as const,
    });
    this.practiceSkillsCompositeVsBaseline = this.getOrCreateHistogram({
      name: 'z_practice_skills_composite_score_vs_baseline',
      help: 'Agents v2 Фаза C1 — delta(composite_score - baseline_score) после оценки skill\'а evaluator\'ом.',
      labelNames: [] as const,
      buckets: [-0.5, -0.3, -0.15, -0.05, 0, 0.05, 0.1, 0.15, 0.3, 0.5],
    });
    this.practiceSkillsRetrievalHitTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_retrieval_hits_total',
      help: 'Agents v2 Фаза C1 — каждый retrieval-вызов, вернувший ≥1 PracticeSkill для clone-respond.',
      labelNames: ['scope'] as const,
    });

    // ── Agents v2 Фаза C2 (2026-05-30) — GEPA prompt evolution ──────
    this.gepaOptimizationsTotal = this.getOrCreateCounter({
      name: 'z_gepa_optimizations_total',
      help: 'Agents v2 Фаза C2 — счётчик запусков GEPA-optimize (status=success|failed|timeout).',
      labelNames: ['prompt_key', 'status'] as const,
    });
    this.gepaCandidatesTotal = this.getOrCreateGauge({
      name: 'z_gepa_candidates_total',
      help: 'Agents v2 Фаза C2 — gauge: сколько PromptCandidate по (prompt_key × status).',
      labelNames: ['prompt_key', 'status'] as const,
    });
    this.gepaPromotedTotal = this.getOrCreateCounter({
      name: 'z_gepa_promoted_total',
      help: 'Agents v2 Фаза C2 — каждый PromptCandidate, прошедший A/B и промоутенный в LlmTaskRoute.promptOverride.',
      labelNames: ['prompt_key'] as const,
    });
    this.gepaRejectedTotal = this.getOrCreateCounter({
      name: 'z_gepa_rejected_total',
      help: 'Agents v2 Фаза C2 — счётчик отклонённых candidate (reason=ab_deg_detected|admin_edit_blocks_promotion|manual_reject|stale).',
      labelNames: ['reason'] as const,
    });
    this.gepaAbActiveTotal = this.getOrCreateGauge({
      name: 'z_gepa_ab_active_total',
      help: 'Agents v2 Фаза C2 — сколько PromptCandidate сейчас в status=testing (A/B активен).',
      labelNames: [] as const,
    });
    this.gepaCostUsdTotal = this.getOrCreateCounter({
      name: 'z_gepa_cost_usd_total',
      help: 'Agents v2 Фаза C2 — кумулятивная стоимость GEPA-runs в USD (tenant-bucket).',
      labelNames: ['tenant_top'] as const,
    });
    this.gepaRollbackTotal = this.getOrCreateCounter({
      name: 'z_gepa_rollback_total',
      help: 'Agents v2 Фаза C2 — auto-rollback кандидата ab-monitor cron\'ом (reason=ab_deg|manual|stale).',
      labelNames: ['reason'] as const,
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
    // KC-Temporal W3.2 (2026-05-25) — сколько раз подмешали reasoning chain
    // в LLM-контекст ответа.
    this.chatV2ReasoningChainsAttachedTotal = this.getOrCreateCounter({
      name: 'chat_v2_reasoning_chains_attached_total',
      help: 'KC-Temporal W3.2 — сколько reasoning chain подмешано в контекст ответа Chat-v2 (label depth=1|2).',
      labelNames: ['depth'] as const,
    });
    // KC-Temporal W3.3 (2026-05-25) — гистограмма числа contradicting блоков
    // в LLM-контексте каждого ответа Chat-v2.
    this.chatV2ContradictingBlocksInContext = this.getOrCreateHistogram({
      name: 'chat_v2_contradicting_blocks_in_context',
      help: 'KC-Temporal W3.3 — число contradicting блоков в LLM-контексте ответа Chat-v2 (за один ask).',
      labelNames: [] as const,
      buckets: [0, 1, 2, 3, 5, 8, 12],
    });

    // ── dialog-layer (SBA α-5) ───────────────────────────────────────
    this.answerCacheHitTotal = this.getOrCreateCounter({
      name: 'answer_cache_hit_total',
      help: 'SBA α-5 dialog-layer — AnswerCache hit (tenant_top). Cache hit = 0 LLM calls.',
      labelNames: ['tenant_top'] as const,
    });
    this.retrievalCacheHitTotal = this.getOrCreateCounter({
      name: 'retrieval_cache_hit_total',
      help: 'SBA α-5 dialog-layer — RetrievalCache hit (tenant_top). Cache hit = пропускаем cosine+BM25+граф.',
      labelNames: ['tenant_top'] as const,
    });
    this.dialogProcessingDurationSeconds = this.getOrCreateHistogram({
      name: 'dialog_processing_duration_seconds',
      help: 'SBA α-5 dialog-layer — длительность шагов препроцессора (step ∈ contextualize|confidence|classify|multi-query|summarize|total).',
      labelNames: ['step'] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
    });
    this.conversationSummaryTotal = this.getOrCreateCounter({
      name: 'conversation_summary_total',
      help: 'SBA α-5 dialog-layer — сколько раз ConversationSummarizerCron сжал диалог в summary (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.dialogConfidenceLowTotal = this.getOrCreateCounter({
      name: 'dialog_confidence_low_total',
      help: 'SBA α-5 dialog-layer — сколько раз confidence < порога → fallback на raw userMessage (tenant_top).',
      labelNames: ['tenant_top'] as const,
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
    this.cloneAskRefusedTotal = this.getOrCreateCounter({
      name: 'clone_ask_refused_total',
      help: 'Фаза 1 clone-reliability-hardening — программный отказ клона отвечать (reason: topic_starved | …). Растёт ДО вызова модели — экономит токены и блокирует deepfake-риск.',
      labelNames: ['reason'] as const,
    });

    // ── SBA γ-1 доделки — SkillTraitCategory + hybrid versioning ──
    this.skillCategoriesTotal = this.getOrCreateGauge({
      name: 'skill_categories_total',
      help: 'SBA γ-1 доделки — количество активных (deletedAt IS NULL) SkillTraitCategory (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.skillTraitCategorizedRatio = this.getOrCreateGauge({
      name: 'skill_trait_categorized_ratio',
      help: 'SBA γ-1 доделки — доля SkillTrait с заполненным categoryId (0..1) per tenant_top.',
      labelNames: ['tenant_top'] as const,
    });
    this.executablePersonaSnapshotsTotal = this.getOrCreateCounter({
      name: 'executable_persona_snapshots_total',
      help: 'SBA γ-1 доделки — сколько ExecutablePersona snapshot создано (trigger: scheduled|threshold|critical|manual|on_demand).',
      labelNames: ['tenant_top', 'trigger'] as const,
    });
    this.executablePersonaSnapshotLagSeconds = this.getOrCreateGauge({
      name: 'executable_persona_snapshot_lag_seconds',
      help: 'SBA γ-1 доделки — лаг (секунды) от триггерного события до создания snapshot (последнее значение per tenant_top).',
      labelNames: ['tenant_top'] as const,
    });

    // ── clone-reliability-hardening Фаза 5 — реактивная пересборка персоны ──
    this.personaRebuildTriggeredTotal = this.getOrCreateCounter({
      name: 'persona_rebuild_triggered_total',
      help: 'Фаза 5 clone-reliability — сколько раз cron-watcher триггернул rebuild ExecutablePersona по reason: trait_delta | max_age.',
      labelNames: ['reason'] as const,
    });

    // ── clone-reliability-hardening Фаза 2 — Смысловые блоки навыка ──
    this.skillTraitConceptsTotal = this.getOrCreateGauge({
      name: 'skill_trait_concepts_total',
      help: 'Фаза 2 clone-reliability — количество SkillTraitConcept по статусу (active|merged_into|archived). Гейдж обновляется cron-нормализатором раз в сутки.',
      labelNames: ['status'] as const,
    });
    this.skillTraitConceptsMergedTotal = this.getOrCreateCounter({
      name: 'skill_trait_concepts_merged_total',
      help: 'Фаза 2 clone-reliability — общее число операций слияния SkillTraitConcept в cron-нормализаторе.',
      labelNames: [] as const,
    });

    // ── TZ clone-method Э1.2 (2026-06-12) — Reflection-слой принципов роли ──
    this.rolePrinciplesSynthesizedTotal = this.getOrCreateCounter({
      name: 'role_principles_synthesized_total',
      help: 'TZ clone-method Э1.2 — исходы синтеза RolePrinciple ночным cron (outcome: created | merged | rejected_guard). rejected_guard = код-гард отбросил диагностическую лексику.',
      labelNames: ['outcome'] as const,
    });
    this.rolePrinciplesActiveTotal = this.getOrCreateGauge({
      name: 'role_principles_active_total',
      help: 'TZ clone-method Э1.2 — gauge числа active RolePrinciple по всем Org (обновляется cron-синтезатором раз в сутки).',
      labelNames: [] as const,
    });

    // ── TZ clone-method ВАЛ.1 (2026-06-12) — поведенческая валидация persona ──
    this.clonePersonaLayerScore = this.getOrCreateHistogram({
      name: 'clone_persona_layer_score',
      help: 'TZ clone-method ВАЛ.1 — score (0..1) LLM-судьи поведенческой верности ответа клона реальному ходу роли (variant: v1 — baseline «только черты» | v2 — все слои метода). Еженедельный офлайн-прогон, ничего не блокирует.',
      labelNames: ['variant'] as const,
      buckets: [0, 0.25, 0.5, 0.75, 0.9, 1],
    });
    this.personaLayerValidationCasesTotal = this.getOrCreateCounter({
      name: 'persona_layer_validation_cases_total',
      help: 'TZ clone-method ВАЛ.1 — кейсы еженедельной поведенческой валидации persona (outcome: judged — оценён судьёй | skipped — кейс упал / битый JSON судьи).',
      labelNames: ['outcome'] as const,
    });

    // ── Clones=Roles Ф2 (2026-05-25) — версионирование клонов ролей ──
    this.cloneRoleVersionCreatedTotal = this.getOrCreateCounter({
      name: 'clones_role_version_created_total',
      help: 'Clones=Roles Ф2 — сколько раз была создана новая версия ExecutablePersona(scope=role) при смене носителя роли (label role_id).',
      labelNames: ['role_id'] as const,
    });
    this.cloneRoleVersionsTotal = this.getOrCreateGauge({
      name: 'clones_role_versions_total',
      help: 'Clones=Roles Ф2 — общее число версий клона на роль (включая archived/superseded/pending_rebuild). Обновляется в ClonesService.getCloneHistory.',
      labelNames: ['role_id'] as const,
    });

    // ── SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router ──
    this.axisLabelsTotal = this.getOrCreateCounter({
      name: 'axis_labels_total',
      help: 'SBA α-3 wave 3 — axis-метки, проставленные AxisClassifierService (tenant_top × axis × source). axis ∈ who|functional|contextual|temporal; source ∈ static|llm|manual. tenant_top — top-100 + "other" для контроля cardinality.',
      labelNames: ['tenant_top', 'axis', 'source'] as const,
    });
    this.routerFallbackCallsTotal = this.getOrCreateCounter({
      name: 'router_fallback_calls_total',
      help: 'SBA α-3 wave 3 — вызовы LLM-fallback роутера для unmatched signalType (tenant_top × result). result ∈ matched|no_match|llm_error.',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.routerFallbackCacheHitTotal = this.getOrCreateCounter({
      name: 'router_fallback_cache_hit_total',
      help: 'SBA α-3 wave 3 — попадание в Redis-кэш LLM-fallback (tenant_top). Cache hit = 0 LLM calls.',
      labelNames: ['tenant_top'] as const,
    });
    this.axisClassifyDurationSeconds = this.getOrCreateHistogram({
      name: 'axis_classify_duration_seconds',
      help: 'SBA α-3 wave 3 — длительность одного LLM-вызова axis-classify (секунды) per axis ∈ functional|temporal.',
      labelNames: ['axis'] as const,
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    });

    // ── SBA α-9 wave 3 — Company Foundation ──
    this.maturityScoreAvg = this.getOrCreateGauge({
      name: 'maturity_score_avg',
      help: 'SBA α-9 — средний maturityScore (0..1) по scope ∈ {role|department|company}. tenant_top — top-100 или other.',
      labelNames: ['tenant_top', 'scope'] as const,
    });
    this.domainsTotal = this.getOrCreateGauge({
      name: 'domains_total',
      help: 'SBA α-9 — количество активных FunctionalDomain в тенанте (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.departmentsTotal = this.getOrCreateGauge({
      name: 'departments_total',
      help: 'SBA α-9 — количество активных Department в тенанте (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.companyProfileCompleteness = this.getOrCreateGauge({
      name: 'company_profile_completeness',
      help: 'SBA α-9 — completeness CompanyProfile (0..1) по тенанту (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.domainExpanderCreatedTotal = this.getOrCreateCounter({
      name: 'domain_expander_created_total',
      help: 'SBA α-9 — сколько новых FunctionalDomain создано domain-expander cron-job (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.maturityScorerDurationSeconds = this.getOrCreateHistogram({
      name: 'maturity_scorer_duration_seconds',
      help: 'SBA α-9 — длительность пересчёта MaturityScorer (по scope).',
      labelNames: ['scope'] as const,
      buckets: [0.1, 0.5, 1, 5, 15, 60, 180, 600],
    });

    // ── SBA α-8 wave 3 — Appointment + KPI ──
    this.appointmentsTotal = this.getOrCreateGauge({
      name: 'appointments_total',
      help: 'SBA α-8 wave 3 — число Appointment в каждой Org × status (tenant_top × status). tenant_top: top-100 + "other" для контроля cardinality.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.kpiMeasurementsTotal = this.getOrCreateCounter({
      name: 'kpi_measurements_total',
      help: 'SBA α-8 wave 3 — счётчик PATCH /kpi/:id/measurement (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.kpiOverdueMeasurementsTotal = this.getOrCreateGauge({
      name: 'kpi_overdue_measurements_total',
      help: 'SBA α-8 wave 3 — KPI с lastMeasuredAt вне frequency-окна (tenant_top × frequency). Считается cron-job\'ом (если включён) или ad-hoc.',
      labelNames: ['tenant_top', 'frequency'] as const,
    });
    this.personRoleToAppointmentMigrationProgress = this.getOrCreateGauge({
      name: 'person_role_to_appointment_migration_progress',
      help: 'SBA α-8 wave 3 — доля PersonRole, у которых уже есть Appointment с тем же (personId,roleId,validFrom) (0..1; tenant_top).',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-7 — Brand Voice Curator ──
    this.brandVoiceProfileCompleteness = this.getOrCreateGauge({
      name: 'brand_voice_profile_completeness',
      help: 'SBA β-7 — completeness BrandVoiceProfile (0..1) на тенант (tenant_top). 0 = профиля нет или корпус ниже порога.',
      labelNames: ['tenant_top'] as const,
    });
    this.brandVoiceExtractorRunsTotal = this.getOrCreateCounter({
      name: 'brand_voice_extractor_runs_total',
      help: 'SBA β-7 — запуски daily-cron BrandVoiceExtractor (result: built | skipped_disabled | skipped_low_corpus | llm_error | db_error).',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.brandVoiceCorpusSize = this.getOrCreateGauge({
      name: 'brand_voice_corpus_size',
      help: 'SBA β-7 — число документов с useCases includes "brand_corpus" на тенант (tenant_top). Обновляется внутри extractor.',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-6 — Experiment Tracker ──
    // Cardinality-safe: tenant_top (top-100 + 'other'), status ограничен
    // 5 значениями (hypothesis|running|completed|dropped|paused).
    this.experimentsTotal = this.getOrCreateGauge({
      name: 'experiments_total',
      help: 'SBA β-6 — число экспериментов в каждой Org × status (tenant_top × status). 5 status: hypothesis|running|completed|dropped|paused.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.experimentsRunningDurationDays = this.getOrCreateHistogram({
      name: 'experiments_running_duration_days',
      help: 'SBA β-6 — длительность running-экспериментов (дни от startedAt до now или completedAt). Используется для probe «running_too_long».',
      labelNames: ['tenant_top'] as const,
      buckets: [1, 3, 7, 14, 30, 60, 90, 180, 365],
    });
    this.experimentsLessonsExtractedTotal = this.getOrCreateCounter({
      name: 'experiments_lessons_extracted_total',
      help: 'SBA β-6 — сколько уроков (lessonsJson entries) извлечено из завершённых экспериментов (tenant_top).',
      labelNames: ['tenant_top'] as const,
    });
    this.experimentDetectorRunsTotal = this.getOrCreateCounter({
      name: 'experiment_detector_runs_total',
      help: 'SBA β-6 — итог одного запуска experiment-detector worker (tenant_top × result). result: created | updated | skipped | error.',
      labelNames: ['tenant_top', 'result'] as const,
    });

    // ── SBA α-8 wave 4 — Role Map builder + completeness cron ──
    this.roleMapCompletenessAvg = this.getOrCreateGauge({
      name: 'role_map_completeness_avg',
      help: 'SBA α-8 wave 4 — средняя completeness Role Map (0..1) по всем активным Role тенанта.',
      labelNames: ['tenant_top'] as const,
    });
    this.roleMapBuilderRunsTotal = this.getOrCreateCounter({
      name: 'role_map_builder_runs_total',
      help: 'SBA α-8 wave 4 — запуски RoleMapBuilderWorker (один flush батча = один inc). result ∈ built|skipped_below_threshold|skipped_disabled|llm_error|db_error.',
      labelNames: ['tenant_top', 'result'] as const,
    });
    this.roleMapExtractDurationSeconds = this.getOrCreateHistogram({
      name: 'role_map_extract_duration_seconds',
      help: 'SBA α-8 wave 4 — длительность одного LLM-вызова role-map-extract (секунды).',
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    });
    this.rolesWithNormalizedDataRatio = this.getOrCreateGauge({
      name: 'roles_with_normalized_data_ratio',
      help: 'SBA α-8 wave 4 — доля Role тенанта, у которых completeness ≥ 0.55 (т.е. заполнены минимум 5 из 9 слотов).',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-8 — DailyCheckIn + Operations + PersonalRelation ──
    this.dailyCheckinsCompletedTotal = this.getOrCreateCounter({
      name: 'daily_checkins_completed_total',
      help: 'SBA β-8 — фактически закрытые daily check-in (kind ∈ morning|evening).',
      labelNames: ['tenant_top', 'kind'] as const,
    });
    this.dailyCheckinsSkippedTotal = this.getOrCreateCounter({
      name: 'daily_checkins_skipped_total',
      help: 'SBA β-8 — пропуски prompt-cron (reason ∈ already_completed|outside_window|disabled|no_channel|no_person|low_confidence).',
      labelNames: ['tenant_top', 'kind', 'reason'] as const,
    });
    this.operationsBlockersTotal = this.getOrCreateGauge({
      name: 'operations_blockers_total',
      help: 'SBA β-8 — снапшот активных блокеров (signalType=blocker) на момент пересчёта OperationsDashboardService.',
      labelNames: ['tenant_top', 'severity'] as const,
    });
    this.teamFrictionsTotal = this.getOrCreateGauge({
      name: 'team_frictions_total',
      help: 'SBA β-8 — снапшот активных team_friction EntityLink на момент пересчёта дашборда.',
      labelNames: ['tenant_top'] as const,
    });
    this.goalCascadeMissesTotal = this.getOrCreateCounter({
      name: 'goal_cascade_misses_total',
      help: 'SBA β-8 — счётчик выставленных cascadeMissed=true (один ребёнок parent в abandoned = один inc).',
      labelNames: ['tenant_top'] as const,
    });
    this.personalRelationBuilderRunsTotal = this.getOrCreateCounter({
      name: 'personal_relation_builder_runs_total',
      help: 'SBA β-8 — результат запуска детектора конфликтов. result ∈ link_created|link_updated|skipped_low_confidence|skipped_no_pair|error. source ∈ graph|regex.',
      labelNames: ['tenant_top', 'result', 'source'] as const,
    });

    // ── ТЗ-2 Ф1 — отдача главной директора (новая компоновка) ──
    this.dashboardValueStripServedTotal = this.getOrCreateCounter({
      name: 'dashboard_value_strip_served_total',
      help: 'ТЗ-2 Ф1 — сколько раз отдана «Полоса пользы» директора (5 твёрдых счётчиков). tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });
    this.dashboardMainFirstScreenWidgetCount = this.getOrCreateGauge({
      name: 'dashboard_main_first_screen_widget_count',
      help: 'ТЗ-2 Ф1 — число величин на первом экране новой компоновки главной директора (≤7). tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });

    // ── ТЗ-2 Ф4 — недельный план-факт по людям ──
    this.weeklyPerPersonSelfViewServedTotal = this.getOrCreateCounter({
      name: 'weekly_per_person_self_view_served_total',
      help: 'ТЗ-2 Ф4 — сколько раз отдан self-view недельного план-факта (/me/weekly-per-person). tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });
    this.weeklyPerPersonNoAnswerTotal = this.getOrCreateCounter({
      name: 'weekly_per_person_no_answer_total',
      help: 'ТЗ-2 Ф4 — суммарное число обещаний «без ответа» (commitmentStatus=asked) при расчёте недельного план-факта. tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });

    // ── ТЗ-2 Ф5 — виджеты ежедневной ценности в /me ──
    this.myIdeasFateServedTotal = this.getOrCreateCounter({
      name: 'me_ideas_fate_served_total',
      help: 'ТЗ-2 Ф5 — сколько раз отдан self-эндпоинт «судьба моих идей» (/me/ideas). tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });
    this.myRecognitionsServedTotal = this.getOrCreateCounter({
      name: 'me_recognitions_served_total',
      help: 'ТЗ-2 Ф5 — сколько раз отдан self-эндпоинт «полученные признания» (/me/recognitions). tenant_top — top-100 bucket через tenantTopOf.',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-8.1 — добивка панели операционного директора ──
    this.cooSentimentAnalyzedTotal = this.getOrCreateCounter({
      name: 'coo_sentiment_analyzed_total',
      help: 'SBA β-8.1 — итоги анализа настроения чек-ина (sentiment ∈ green|yellow|red).',
      labelNames: ['tenant_top', 'sentiment'] as const,
    });
    this.cooSentimentFailedTotal = this.getOrCreateCounter({
      name: 'coo_sentiment_failed_total',
      help: 'SBA β-8.1 — счётчик отказов LLM при анализе настроения чек-ина. reason: invalid_element (silent-skip батч-парсером) | other (LLM down / нет tool_call / update упал).',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.checkinGraphIngestTotal = this.getOrCreateCounter({
      name: 'z_checkin_graph_ingest_total',
      help: 'ТЗ 2026-06-10-daily-checkin-to-graph-bridge — мост чек-ин → knowledge-core. result: ok (RawEvent создан или идемпотентный возврат) | skipped (пустой чек-ин / нет записи / kill-switch off) | error (исключение моста, best-effort).',
      labelNames: ['result'] as const,
    });
    this.cooWeeklyDigestGeneratedTotal = this.getOrCreateCounter({
      name: 'coo_weekly_digest_generated_total',
      help: 'SBA β-8.1 — успешно сгенерированный недельный дайджест операционного директора.',
      labelNames: ['tenant_top'] as const,
    });
    this.cooWeeklyDigestFailedTotal = this.getOrCreateCounter({
      name: 'coo_weekly_digest_failed_total',
      help: 'SBA β-8.1 — провал генерации недельного дайджеста (reason ∈ llm_failed|aggregation_failed|notify_failed|exception).',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.cooTeamTemperatureRedShare = this.getOrCreateGauge({
      name: 'coo_team_temperature_red_share',
      help: 'SBA β-8.1 — доля красных чек-инов за 7 дней (0..1). Тревога Grafana при > 0.3.',
      labelNames: ['tenant_top'] as const,
    });
    // ── ТЗ-2 Ф2 — «зеркало закрытого» + capacity-виджет COO ──
    this.cooBlockersResolvedTotal = this.getOrCreateGauge({
      name: 'coo_blockers_resolved_total',
      help: 'ТЗ-2 Ф2 — блокеры (BlockerSynthesis), закрытые (status=resolved) за последние 30 дней. «Зеркало закрытого» на COO-дашборде.',
      labelNames: ['tenant_top'] as const,
    });
    this.cooTeamCapacityWidgetServedTotal = this.getOrCreateCounter({
      name: 'coo_team_capacity_widget_served_total',
      help: 'ТЗ-2 Ф2 — отдача виджета загрузки команд COO (GET /dashboard/operations/team-capacity).',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-8.3 — ежедневный отчёт COO ──
    this.cooDailyDigestGeneratedTotal = this.getOrCreateCounter({
      name: 'coo_daily_digest_generated_total',
      help: 'SBA β-8.3 — успешно сгенерированный ежедневный дайджест операционного директора.',
      labelNames: ['tenant_top'] as const,
    });
    this.cooDailyDigestFailedTotal = this.getOrCreateCounter({
      name: 'coo_daily_digest_failed_total',
      help: 'SBA β-8.3 — провал генерации ежедневного дайджеста (reason ∈ llm_failed|aggregation_failed|notify_failed|exception).',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.cooDailyDigestDeliveredTotal = this.getOrCreateCounter({
      name: 'coo_daily_digest_delivered_total',
      help: 'SBA β-8.3 — счётчик удачных доставок ежедневного дайджеста (channel ∈ conversational).',
      labelNames: ['tenant_top', 'channel'] as const,
    });
    this.cooDailyDigestAgeSeconds = this.getOrCreateGauge({
      name: 'coo_daily_digest_age_seconds',
      help: 'SBA β-8.3 — возраст последнего ежедневного дайджеста (now − createdAt) в секундах. Тревога Grafana при > 25 часов.',
      labelNames: ['tenant_top'] as const,
    });

    // ── «Месяц компании» — месячный отчёт COO ──
    this.cooMonthlyDigestGeneratedTotal = this.getOrCreateCounter({
      name: 'coo_monthly_digest_generated_total',
      help: '«Месяц компании» — успешно сгенерированный месячный дайджест операционного директора.',
      labelNames: ['tenant_top'] as const,
    });
    this.cooMonthlyDigestFailedTotal = this.getOrCreateCounter({
      name: 'coo_monthly_digest_failed_total',
      help: '«Месяц компании» — провал генерации месячного дайджеста (reason ∈ llm_failed|aggregation_failed|notify_failed|exception).',
      labelNames: ['tenant_top', 'reason'] as const,
    });
    this.cooMonthlyDigestDeliveredTotal = this.getOrCreateCounter({
      name: 'coo_monthly_digest_delivered_total',
      help: '«Месяц компании» — счётчик удачных доставок месячного дайджеста (channel ∈ conversational).',
      labelNames: ['tenant_top', 'channel'] as const,
    });

    // ── TZ-1 Ф3.D — фиксы достоверности агентов ──
    this.commitmentAuthorCoverageRatio = this.getOrCreateGauge({
      name: 'commitment_author_coverage_ratio',
      help: 'TZ-1 Ф3.D.1 — доля commitment с непустым commitmentAuthorPersonId в прогоне goal-vector (0..1). Ниже goals.author_coverage_min → атрибуция откатывается на адресата.',
      labelNames: ['tenant_top'] as const,
    });
    this.probeSuggestedTotal = this.getOrCreateCounter({
      name: 'probe_suggested_total',
      help: 'TZ-1 Ф3.D.3 — сработавший risk/probe-триггер burnout-детектора (trigger ∈ reply_latency_rise|workload_overload|meeting_noshows).',
      labelNames: ['trigger'] as const,
    });

    // ── SBA β-8.3 Wave 2 — COO overview расширения ──
    this.cooInsightsByCauseTotal = this.getOrCreateGauge({
      name: 'coo_insights_by_cause_total',
      help: 'SBA β-8.3 Wave 2 — снапшот числа активных insights за 7 дней по категории первопричины (cause ∈ process_gap|tooling|role_skill|communication|priority|resource_constraint|external|unknown).',
      labelNames: ['tenant_top', 'cause'] as const,
    });
    this.cooCompanyMaturityScore = this.getOrCreateGauge({
      name: 'coo_company_maturity_score',
      help: 'SBA β-8.3 Wave 2 — текущий CompanyProfile.maturityScore (0..1). Не публикуется, если значение null.',
      labelNames: ['tenant_top'] as const,
    });

    // ── SBA β-8.2 — Promise Keeper («Хранитель обещаний») ──
    this.commitmentsOpenTotal = this.getOrCreateGauge({
      name: 'commitments_open_total',
      help: 'SBA β-8.2 — снапшот висящих обещаний (commitmentStatus="open"|"asked").',
      labelNames: ['tenant_top'] as const,
    });
    this.commitmentsAskedTotal = this.getOrCreateCounter({
      name: 'commitments_asked_total',
      help: 'SBA β-8.2 — сколько раз cron Хранителя обещаний отправил followup probe.',
      labelNames: ['tenant_top'] as const,
    });
    this.commitmentsFulfilledTotal = this.getOrCreateCounter({
      name: 'commitments_fulfilled_total',
      help: 'SBA β-8.2 — подтверждённые «сделано» по обещаниям.',
      labelNames: ['tenant_top'] as const,
    });
    this.commitmentsMissedTotal = this.getOrCreateCounter({
      name: 'commitments_missed_total',
      help: 'SBA β-8.2 — подтверждённые «не сделано» по обещаниям.',
      labelNames: ['tenant_top'] as const,
    });
    this.commitmentsEscalatedTotal = this.getOrCreateCounter({
      name: 'commitments_escalated_total',
      help: 'SBA β-8.2 — счётчик эскалаций (probe COO + owner) при молчании сотрудника N дней.',
      labelNames: ['tenant_top'] as const,
    });
    this.commitmentsExtractFailedTotal = this.getOrCreateCounter({
      name: 'commitments_extract_failed_total',
      help: 'SBA β-8.2 — провал LLM-разбора ответа сотрудника на followup (reason ∈ llm_failed|parse_failed|no_block|exception).',
      labelNames: ['tenant_top', 'reason'] as const,
    });

    // ── SBA γ-2 — Concierge Agent ─────────────────────────────────────
    this.conciergeMessagesTotal = this.getOrCreateCounter({
      name: 'concierge_messages_total',
      help: 'SBA γ-2 — сколько user-сообщений принял Concierge Agent. Cardinality-safe: tenant_top bucket.',
      labelNames: ['tenant_top'] as const,
    });
    this.conciergeToolCallsTotal = this.getOrCreateCounter({
      name: 'concierge_tool_calls_total',
      help: 'SBA γ-2 — выполненные tool calls (status ∈ ok|error|forbidden). tool — имя whitelist tool ServiceMap.',
      labelNames: ['tenant_top', 'tool', 'status'] as const,
    });
    this.conciergeUndoTotal = this.getOrCreateCounter({
      name: 'concierge_undo_total',
      help: 'SBA γ-2 — успешные откаты tool calls через POST /concierge/undo/:logId.',
      labelNames: ['tenant_top', 'tool'] as const,
    });
    this.conciergeQuotaExceededTotal = this.getOrCreateCounter({
      name: 'concierge_quota_exceeded_total',
      help: 'SBA γ-2 — попытки сверх лимита (scope ∈ daily|monthly).',
      labelNames: ['tenant_top', 'scope'] as const,
    });
    // ТЗ 2026-05-27 Фаза 4 — dialog-layer + AnswerCache + pre-retrieval observability.
    this.conciergeDialogLayerUsedTotal = this.getOrCreateCounter({
      name: 'concierge_dialog_layer_used_total',
      help: 'ТЗ 2026-05-27 Фаза 4 — сколько раз dialog-layer препроцессор применился к запросу Concierge. intent ∈ factual|exploratory|analytical|clone_roleplay|unknown.',
      labelNames: ['intent'] as const,
    });
    this.conciergeCacheHitTotal = this.getOrCreateCounter({
      name: 'concierge_cache_hit_total',
      help: 'ТЗ 2026-05-27 Фаза 4 — сколько раз dialog-layer AnswerCache вернул готовый ответ (short-circuit без LLM).',
      labelNames: [] as const,
    });
    this.conciergePreRetrievalHitsCount = this.getOrCreateHistogram({
      name: 'concierge_pre_retrieval_hits_count',
      help: 'ТЗ 2026-05-27 Фаза 4 — суммарное число hits pre-retrieval search_knowledge по всем queries dialog-layer (для калибровки topK).',
      labelNames: [] as const,
      buckets: [0, 1, 3, 5, 10, 15, 25, 50],
    });

    // ── SBA δ-1 — Orchestrator ────────────────────────────────────────
    this.orchestratorRunsTotal = this.getOrCreateCounter({
      name: 'orchestrator_runs_total',
      help: 'SBA δ-1 — кол-во запусков Orchestrator-а (multi-agent research). status ∈ done|failed|timeout|cancelled.',
      labelNames: ['status'] as const,
    });
    this.orchestratorSubagentsTotal = this.getOrCreateCounter({
      name: 'orchestrator_subagents_total',
      help: 'SBA δ-1 — кол-во запущенных subagent-ов. agent_type ∈ entity_research|comparison|topic_summary|timeline_construction; result ∈ done|failed|low_confidence.',
      labelNames: ['agent_type', 'result'] as const,
    });
    this.orchestratorRunDurationSeconds = this.getOrCreateHistogram({
      name: 'orchestrator_run_duration_seconds',
      help: 'SBA δ-1 — длительность Orchestrator-run целиком (от planning до done/failed).',
      labelNames: [] as const,
      buckets: [5, 10, 30, 60, 120, 300, 600, 900, 1500],
    });
    this.orchestratorVerificationLowConfidenceTotal = this.getOrCreateCounter({
      name: 'orchestrator_verification_low_confidence_total',
      help: 'SBA δ-1 — сколько раз verification вернул confidence < 0.6 (после которого запускается retry max 1 раз).',
      labelNames: [] as const,
    });

    // ── SBA δ-3 — VoiceChannelAdapter (TTS + ASR REST) ───────────────
    this.voiceAsrRequestsTotal = this.getOrCreateCounter({
      name: 'voice_asr_requests_total',
      help: 'SBA δ-3 — REST-вызов /api/v1/voice/transcribe (счётчик по provider × tenant_top bucket).',
      labelNames: ['tenant_top', 'provider'] as const,
    });
    this.voiceAsrDurationSeconds = this.getOrCreateHistogram({
      name: 'voice_asr_duration_seconds',
      help: 'SBA δ-3 — длительность ASR-вызова через VoiceChannelAdapter (Vox submit+poll, секунды). Cardinality-safe: только provider, без tenant.',
      labelNames: ['provider'] as const,
      buckets: [0.5, 1, 3, 5, 10, 20, 40, 60, 120, 300],
    });
    this.voiceTtsRequestsTotal = this.getOrCreateCounter({
      name: 'voice_tts_requests_total',
      help: 'SBA δ-3 — REST-вызов /api/v1/voice/synthesize (счётчик по provider × tenant_top).',
      labelNames: ['tenant_top', 'provider'] as const,
    });
    this.voiceTtsCharsTotal = this.getOrCreateCounter({
      name: 'voice_tts_chars_total',
      help: 'SBA δ-3 — суммарное количество символов, отправленных в TTS (для cost-tracking). Cardinality-safe: только tenant_top, без provider/voice.',
      labelNames: ['tenant_top'] as const,
    });

    // ── T4 / δ-3 — VoiceStreamGateway (WS chunk streaming) ────────────
    this.voiceWsSessionTotal = this.getOrCreateCounter({
      name: 'z_voice_ws_session_total',
      help: 'T4 δ-3 — завершение voice WS-сессии в ConciergeVoice; outcome ∈ completed|cancelled|error|timeout.',
      labelNames: ['outcome'] as const,
    });
    this.voiceWsChunkTotal = this.getOrCreateCounter({
      name: 'z_voice_ws_chunk_total',
      help: 'T4 δ-3 — приём audio-chunk в voice WS gateway (timeslice 200ms). Cardinality-safe: без labels.',
      labelNames: [] as const,
    });
    this.voiceWsAsrLatencyMs = this.getOrCreateHistogram({
      name: 'z_voice_ws_asr_latency_ms',
      help: 'T4 δ-3 — задержка от voice:end до voice:transcribed (ASR submit+poll) в миллисекундах.',
      labelNames: [] as const,
      buckets: [200, 500, 1000, 2000, 5000, 10000],
    });

    // ── SBA α-10 wave 3 — Admin LLM + Unit Economics ────────────────
    this.aiCostUsdLabeledTotal = this.getOrCreateCounter({
      name: 'ai_cost_usd_total_labeled',
      help: 'SBA α-10 wave 3 — суммарная стоимость AI-вызовов USD (tenant_top × task_type × provider × model).',
      labelNames: ['tenant_top', 'task_type', 'provider', 'model'] as const,
    });
    this.aiCostRubLabeledTotal = this.getOrCreateCounter({
      name: 'ai_cost_rub_total',
      help: 'SBA α-10 wave 3 — суммарная стоимость AI-вызовов RUB (через CurrencyRate snapshot).',
      labelNames: ['tenant_top', 'task_type', 'provider', 'model'] as const,
    });
    this.aiCallsLabeledTotal = this.getOrCreateCounter({
      name: 'ai_calls_total',
      help: 'SBA α-10 wave 3 — количество вызовов AI (tenant_top × task_type × provider × model × success).',
      labelNames: [
        'tenant_top',
        'task_type',
        'provider',
        'model',
        'success',
      ] as const,
    });
    this.orgBudgetUtilizationPercent = this.getOrCreateGauge({
      name: 'org_budget_utilization_percent',
      help: 'SBA α-10 wave 3 — текущее использование бюджета Org в % от monthlyCapRub.',
      labelNames: ['tenant_top'] as const,
    });
    this.providerSmokeTestSuccess = this.getOrCreateGauge({
      name: 'provider_smoke_test_success',
      help: 'SBA α-10 wave 3 — последний результат smoke-теста провайдера (1=success, 0=fail).',
      labelNames: ['provider'] as const,
    });
    this.providerSmokeTestDurationSeconds = this.getOrCreateHistogram({
      name: 'provider_smoke_test_duration_seconds',
      help: 'SBA α-10 wave 3 — длительность smoke-теста провайдера, секунды.',
      labelNames: ['provider'] as const,
      buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60],
    });
    this.currencyRateUsdRub = this.getOrCreateGauge({
      name: 'currency_rate_usd_rub',
      help: 'SBA α-10 wave 3 — текущий курс USD/RUB от ЦБ РФ (или fallback).',
    });
    this.currencyRateSyncTotal = this.getOrCreateCounter({
      name: 'currency_rate_sync_total',
      help: 'SBA α-10 wave 3 — попытки sync курса (result ∈ success|fallback|failed).',
      labelNames: ['result'] as const,
    });
    this.dailyCostAggregatorRunsTotal = this.getOrCreateCounter({
      name: 'daily_cost_aggregator_runs_total',
      help: 'SBA α-10 wave 3 — запуски DailyCostAggregatorCron (result ∈ success|failed).',
      labelNames: ['result'] as const,
    });
    this.orgEconomicsRunsTotal = this.getOrCreateCounter({
      name: 'org_economics_runs_total',
      help: 'SBA α-10 wave 3 — запуски OrgEconomicsCron (result ∈ success|failed).',
      labelNames: ['result'] as const,
    });
    this.budgetAlertSentTotal = this.getOrCreateCounter({
      name: 'budget_alert_sent_total',
      help: 'SBA α-10 wave 3 — отправленные budget alerts (threshold ∈ 50|80|95|100|...).',
      labelNames: ['threshold'] as const,
    });

    // ── SBA δ-2 — ProactiveWatcher ─────────────────────────────────────
    this.proactiveNotificationsEmittedTotal = this.getOrCreateCounter({
      name: 'proactive_notifications_emitted_total',
      help: 'SBA δ-2 — отправленные ProactiveNotification (rule × severity).',
      labelNames: ['rule', 'severity'] as const,
    });
    this.proactiveNotificationsDismissedTotal = this.getOrCreateCounter({
      name: 'proactive_notifications_dismissed_total',
      help: 'SBA δ-2 — пользователь нажал «Скрыть» на ProactiveNotification.',
      labelNames: ['rule'] as const,
    });
    this.proactiveNotificationsDedupSkippedTotal = this.getOrCreateCounter({
      name: 'proactive_notifications_dedup_skipped_total',
      help: 'SBA δ-2 — сколько раз anti-spam dedup отбросил ProactiveNotification (Redis SETNX hit).',
      labelNames: [] as const,
    });
    this.proactiveWatcherDurationSeconds = this.getOrCreateHistogram({
      name: 'proactive_watcher_duration_seconds',
      help: 'SBA δ-2 — длительность обработки одного правила ProactiveWatcher (секунды).',
      labelNames: ['rule'] as const,
      buckets: [0.1, 0.5, 1, 3, 5, 10, 30, 60],
    });

    // ── Tracker (Sprint 1 — D-1.2) ────────────────────────────────────
    // Только определения; `.inc()` / `.set()` НЕ вызывается на Sprint 1 —
    // tracker-сервисы (issues / intake / webhooks-out / events bridge)
    // делают это на Sprint 2+. См. plans/sprints/2026-05-24-sprint-plan-wave-1.md.
    this.issuesCreatedTotal = this.getOrCreateCounter({
      name: 'issues_created_total',
      help: 'Tracker — созданные задачи (source ∈ manual|api|meeting|telegram|email|mobile_voice).',
      labelNames: ['tenant', 'project', 'source'] as const,
    });
    this.issuesCompletedTotal = this.getOrCreateCounter({
      name: 'issues_completed_total',
      help: 'Tracker — задачи, переведённые в done (закрытые штатно).',
      labelNames: ['tenant', 'project'] as const,
    });
    // Tracker (2026-05-27) — подзадачи. Инкремент в IssuesService.create()
    // когда передан parentId. Глубина >2 запрещена на уровне сервиса,
    // поэтому это всегда «корневая задача → подзадача».
    this.subtasksCreatedTotal = this.getOrCreateCounter({
      name: 'subtasks_created_total',
      help: 'Tracker — созданные подзадачи (Issue с parentId !== null).',
      labelNames: ['tenant', 'project'] as const,
    });
    this.intakeTriagedTotal = this.getOrCreateCounter({
      name: 'intake_triaged_total',
      help: 'Tracker Intake — обработанные кандидаты (decision ∈ accepted|rejected|snoozed|duplicate).',
      labelNames: ['tenant', 'decision'] as const,
    });
    // NB: имена `tracker_webhook_*` (а не `webhook_*`), потому что
    // `webhook_delivery_total` уже зарегистрирован выше для общего ai-workspace
    // webhooks-пайплайна с label'ами (event, status). Регистрация одного имени
    // с разным набором label'ов = runtime-ошибка prom-client. ТЗ ссылается на
    // `webhook_delivery_total{tenant, event, success}` (см. plans/tz/
    // 2026-05-23-tracker-phase-1-models-api.md §"Метрики Prometheus"), но
    // для tracker'а используем префикс `tracker_*` — это сохраняет
    // backwards-compatibility legacy webhooks-метрики (Grafana dashboards
    // на проде).
    this.trackerWebhookDeliveryTotal = this.getOrCreateCounter({
      name: 'tracker_webhook_delivery_total',
      help: 'Tracker Webhooks Out — доставки исходящих webhook-событий (success ∈ true|false).',
      labelNames: ['tenant', 'event', 'success'] as const,
    });
    this.trackerWebhookRetryCount = this.getOrCreateCounter({
      name: 'tracker_webhook_retry_count',
      help: 'Tracker Webhooks Out — суммарное число retry-попыток на webhook (счётчик, НЕ histogram).',
      labelNames: ['tenant', 'webhook_id'] as const,
    });
    this.trackerEventsToKnowledgeCoreTotal = this.getOrCreateCounter({
      name: 'tracker_events_to_knowledge_core_total',
      help: 'Tracker → knowledge-core bridge — события, отправленные в core.raw-events (type ∈ task_created|task_status_changed|...).',
      labelNames: ['tenant', 'type'] as const,
    });
    // Tracker Phase 3 (Sprint 6, 2026-05-24) — Issue.embedding pipeline.
    this.trackerIssueEmbedTotal = this.getOrCreateCounter({
      name: 'tracker_issue_embed_total',
      help: 'Tracker Phase 3 — обработка job-а embedding для Issue (status ∈ ok|skipped|failed). skipped — hash text не изменился; ok — embedding обновлён; failed — провайдер упал.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.trackerIssueSimilarSearchTotal = this.getOrCreateCounter({
      name: 'tracker_issue_similar_search_total',
      help: 'Tracker Phase 3 — KNN-поиск похожих задач (GET /tracker/issues/:id/similar). Считает все запросы (с/без результатов).',
      labelNames: ['tenant_top'] as const,
    });
    // Tracker Checklists (2026-05-27) — см. plans/tz/2026-05-27-tracker-checklists.md §Метрики.
    this.checklistsCreatedTotal = this.getOrCreateCounter({
      name: 'checklists_created_total',
      help: 'Tracker Checklists — создание чек-листа на задаче (POST /issues/:id/checklists).',
      labelNames: ['tenant', 'project'] as const,
    });
    this.checklistItemsAddedTotal = this.getOrCreateCounter({
      name: 'checklist_items_added_total',
      help: 'Tracker Checklists — добавление пункта в чек-лист. via_bulk=true если через bulk-create, иначе false.',
      labelNames: ['tenant', 'project', 'via_bulk'] as const,
    });
    this.checklistItemsCompletedTotal = this.getOrCreateCounter({
      name: 'checklist_items_completed_total',
      help: 'Tracker Checklists — пункт переведён в isDone=true (фронт-чекбокс).',
      labelNames: ['tenant', 'project'] as const,
    });
    // Tracker Project Documents (2026-05-27) — см. plans/tz/2026-05-27-tracker-project-documents.md §Метрики.
    this.projectDocumentsCreatedTotal = this.getOrCreateCounter({
      name: 'project_documents_created_total',
      help: 'Tracker Project Documents — создание документа проекта (POST /projects/:id/documents).',
      labelNames: ['tenant', 'project'] as const,
    });
    this.projectDocumentsUpdatedTotal = this.getOrCreateCounter({
      name: 'project_documents_updated_total',
      help: 'Tracker Project Documents — обновление документа (PATCH /project-documents/:id, включая auto-save).',
      labelNames: ['tenant', 'project'] as const,
    });
    this.linkedCardsViewTotal = this.getOrCreateCounter({
      name: 'linked_cards_view_total',
      help: 'Tracker Project Documents — запрос блока «Связанные карточки» (GET /projects/:id/linked-cards).',
      labelNames: ['tenant', 'project'] as const,
    });
    // Tracker Phase 3 part C — AI-suggest при создании задачи.
    this.aiIssueInferredTotal = this.getOrCreateCounter({
      name: 'ai_issue_inferred_total',
      help: 'Tracker Phase 3 part C — IssueInferFieldsService завершил inference (accepted=false на момент создания; accepted=true когда фронт принимает hint через PATCH).',
      labelNames: ['tenant_top', 'accepted'] as const,
    });
    this.aiIssueGoalSuggestedTotal = this.getOrCreateCounter({
      name: 'ai_issue_goal_suggested_total',
      help: 'Tracker Phase 3 part C — IssueGoalSuggestService предложил goalId (source ∈ knn|llm|none; accepted=false на момент инференса).',
      labelNames: ['tenant_top', 'accepted', 'source'] as const,
    });
    // Tracker Phase 3 part B — meeting-extract-actions + auto-triage Intake.
    this.aiMeetingActionsExtractedTotal = this.getOrCreateCounter({
      name: 'ai_meeting_actions_extracted_total',
      help: 'Tracker Phase 3 part B — MeetingExtractActionsService отработал. status ∈ created|skipped_idempotent|llm_empty|llm_error.',
      labelNames: ['tenant_top', 'status'] as const,
    });
    this.aiIntakeAutoAcceptedTotal = this.getOrCreateCounter({
      name: 'ai_intake_auto_accepted_total',
      help: 'Tracker Phase 3 part B + W4 autonomy (2026-06-12) — IntakeAutoTriageWorker автоматически принял IntakeIssue (confidence ≥ порога, любой source; via_default_project=true — Issue создан в дефолт-проект «Входящие»).',
      labelNames: ['tenant_top', 'source', 'via_default_project'] as const,
    });
    this.aiIntakeSuggestedTotal = this.getOrCreateCounter({
      name: 'ai_intake_suggested_total',
      help: 'Tracker Phase 3 part B + W4 autonomy (2026-06-12) — IntakeAutoTriageWorker заполнил suggested* (status ∈ auto_accepted|pending|llm_error|skipped_already_triaged; source — канал intake).',
      labelNames: ['tenant_top', 'status', 'source'] as const,
    });
    // Tracker Phase 5 part 1 (2026-05-24) — Import-tracker.
    this.importStartedTotal = this.getOrCreateCounter({
      name: 'import_started_total',
      help: 'Tracker Phase 5 — запуск импорта (tenant_top × source).',
      labelNames: ['tenant_top', 'source'] as const,
    });
    this.importCompletedTotal = this.getOrCreateCounter({
      name: 'import_completed_total',
      help: 'Tracker Phase 5 — финальное завершение импорта (tenant_top × source × success). success="true" для completed, "false" для failed/cancelled.',
      labelNames: ['tenant_top', 'source', 'success'] as const,
    });
    this.importIssuesProcessedTotal = this.getOrCreateCounter({
      name: 'import_issues_processed_total',
      help: 'Tracker Phase 5 — количество обработанных Issue (созданных + skip-existing). Инкрементится в strategies.',
      labelNames: ['tenant_top', 'source'] as const,
    });
    this.issuesByStateCount = this.getOrCreateGauge({
      name: 'issues_by_state_count',
      help: 'Tracker — snapshot количества задач по состоянию (обновляется cron-ом).',
      labelNames: ['tenant', 'project', 'state'] as const,
    });
    this.issuesOverdueCount = this.getOrCreateGauge({
      name: 'issues_overdue_count',
      help: 'Tracker — snapshot количества просроченных задач (dueAt < now AND state != done; обновляется cron-ом).',
      labelNames: ['tenant', 'project'] as const,
    });
    this.intakePendingCount = this.getOrCreateGauge({
      name: 'intake_pending_count',
      help: 'Tracker Intake — snapshot количества IntakeIssue.status=pending (обновляется при изменении статуса).',
      labelNames: ['tenant'] as const,
    });

    // Tracker Phase 4 part 2 — TeamTemplate + HolidayCalendar.
    this.teamTemplateUsedTotal = this.getOrCreateCounter({
      name: 'team_template_used_total',
      help: 'Tracker Phase 4 — POST /projects/from-template создал Project (slug — слаг шаблона: sales|development|installation|...).',
      labelNames: ['tenant_top', 'slug'] as const,
    });
    this.holidayDueDateAdjustedTotal = this.getOrCreateCounter({
      name: 'holiday_due_date_adjusted_total',
      help: 'Tracker Phase 4 — HolidayService сдвинул dueDate задачи на следующий рабочий день (попадание на праздник / выходной).',
      labelNames: ['tenant_top'] as const,
    });
    // Tracker Boards (2026-05-27) — несколько досок per project.
    this.boardsCreatedTotal = this.getOrCreateCounter({
      name: 'boards_created_total',
      help: 'Tracker Boards — создание доски в проекте (BoardsService.create).',
      labelNames: ['tenant_top', 'project'] as const,
    });
    this.boardsArchivedTotal = this.getOrCreateCounter({
      name: 'boards_archived_total',
      help: 'Tracker Boards — архивация доски (POST /boards/:id/archive). Не включает soft-delete.',
      labelNames: ['tenant_top', 'project'] as const,
    });
    this.boardIssuesMovedTotal = this.getOrCreateCounter({
      name: 'board_issues_moved_total',
      help: 'Tracker Boards — задача перенесена между досками (PATCH /issues/:id { boardId }).',
      labelNames: ['tenant_top', 'from_board', 'to_board'] as const,
    });
    this.issueMovedToProjectTotal = this.getOrCreateCounter({
      name: 'issue_moved_to_project_total',
      help: 'Tracker — задача перенесена в другой проект (POST /issues/:id/move).',
      labelNames: ['tenant_top'] as const,
    });
    // Tracker Phase 4 (Email-to-task, T5, 2026-05-24).
    this.mailInboundReceivedTotal = this.getOrCreateCounter({
      name: 'z_mail_inbound_received_total',
      help: 'Tracker Phase 4 (Email-to-task) — каждое письмо, прошедшее через IMAP-polling (status ∈ received|bounced|failed|created).',
      labelNames: ['project_id', 'status'] as const,
    });
    this.mailInboundIssuesCreatedTotal = this.getOrCreateCounter({
      name: 'z_mail_inbound_issues_created_total',
      help: 'Tracker Phase 4 — Issue успешно создан из входящего письма.',
    });
    this.mailInboundBounceTotal = this.getOrCreateCounter({
      name: 'z_mail_inbound_bounce_total',
      help: 'Tracker Phase 4 — bounce при routing письма (reason ∈ alias_not_found|disabled|tenant_mismatch|parse_error).',
      labelNames: ['reason'] as const,
    });
    this.mailInboundAttachmentUploadedTotal = this.getOrCreateCounter({
      name: 'z_mail_inbound_attachment_uploaded_total',
      help: 'Tracker Phase 4 — вложение из письма успешно сохранено в S3 (создан IssueAttachment).',
    });
    // Wave 3 finishing (Sprint 10, 2026-05-24) — probe-trigger
    // `goal_alignment_low`: эмит probe-event, если у user ≥5 задач за 14д и
    // ≥80% без goalId. Cardinality-safe: tenant_top (top-100 + 'other').
    this.probeGoalAlignmentLowEmittedTotal = this.getOrCreateCounter({
      name: 'probe_goal_alignment_low_emitted_total',
      help: 'Wave 3 finishing — emitted probe-events «goal_alignment_low» (≥80% issues пользователя за 14д без связи с Goal).',
      labelNames: ['tenant_top'] as const,
    });

    // ── Wave 2 Поток D — Activity Feeds (2026-05-24) ───────────────────
    this.feedItemsEmittedTotal = this.getOrCreateCounter({
      name: 'feed_items_emitted_total',
      help: 'Activity Feeds — публикация записи в ленту (tenant × feed_type × severity).',
      labelNames: ['tenant', 'feed_type', 'severity'] as const,
    });
    this.feedItemsActionedTotal = this.getOrCreateCounter({
      name: 'feed_items_actioned_total',
      help: 'Activity Feeds — пользователь произвёл действие над записью (status ∈ seen|delivered|responded|actioned|dismissed).',
      labelNames: ['tenant', 'feed_type', 'status'] as const,
    });
    this.feedReactionsTotal = this.getOrCreateCounter({
      name: 'feed_reactions_total',
      help: 'Activity Feeds — реакции пользователей (reaction ∈ thanks|vote).',
      labelNames: ['tenant', 'feed_type', 'reaction'] as const,
    });
    this.feedItemsExpiredTotal = this.getOrCreateCounter({
      name: 'feed_items_expired_total',
      help: 'Activity Feeds — записи, истёкшие по expiresAt (probe-вопросы без ответа > 24-72ч и др.).',
      labelNames: ['tenant', 'feed_type'] as const,
    });

    // ── Calendar MVP (2026-05-25) ───────────────────────────────────
    this.calendarEventsCreatedTotal = this.getOrCreateCounter({
      name: 'calendar_events_created_total',
      help: 'Calendar MVP — создание событий календаря (tenant × kind × visibility).',
      labelNames: ['tenant', 'kind', 'visibility'] as const,
    });
    this.calendarRemindersSentTotal = this.getOrCreateCounter({
      name: 'calendar_reminders_sent_total',
      help: 'Calendar MVP — отправка напоминаний о событиях (tenant × channel × success).',
      labelNames: ['tenant', 'channel', 'success'] as const,
    });
    this.calendarFindFreeSlotTotal = this.getOrCreateCounter({
      name: 'calendar_find_free_slot_total',
      help: 'Calendar MVP — вызовы /events/find-free-slot (tenant × found).',
      labelNames: ['tenant', 'found'] as const,
    });

    // ── Feedback channel + AI clustering (ТЗ 2026-05-25) ──────────────
    this.feedbackDigestRunsTotal = this.getOrCreateCounter({
      name: 'feedback_digest_runs_total',
      help: 'Каждый прогон FeedbackDigestService.runDigest() (result ∈ success|skipped|lock_held|agent_failed|txn_failed|anomaly).',
      labelNames: ['result'] as const,
    });
    this.feedbackDigestMessagesProcessedTotal = this.getOrCreateCounter({
      name: 'feedback_digest_messages_processed_total',
      help: 'Сколько FeedbackMessage было успешно обработано (инкремент на размер батча после успешной транзакции).',
    });
    this.feedbackDigestNewTopicsTotal = this.getOrCreateCounter({
      name: 'feedback_digest_new_topics_total',
      help: 'Сколько новых FeedbackTopic было создано в результате прогонов digest.',
    });
    this.feedbackDigestFailedRunsTotal = this.getOrCreateCounter({
      name: 'feedback_digest_failed_runs_total',
      help: 'Сколько раз сообщения попали в FeedbackMessage.failedRuns >= 3 (хронически невалидные).',
    });

    // Onboarding Tour (ТЗ 2026-05-27) — три счётчика.
    this.tourStartedTotal = this.getOrCreateCounter({
      name: 'tour_started_total',
      help: 'Onboarding-тур начат пользователем (первый PATCH /users/me/tour-progress без completedAt/skipped).',
      labelNames: ['tenant', 'tour_id'] as const,
    });

    this.tourCompletedTotal = this.getOrCreateCounter({
      name: 'tour_completed_total',
      help: 'Onboarding-тур завершён пользователем (PATCH с completedAt).',
      labelNames: ['tenant', 'tour_id'] as const,
    });

    this.tourSkippedTotal = this.getOrCreateCounter({
      name: 'tour_skipped_total',
      help: 'Onboarding-тур пропущен пользователем (PATCH с skipped=true). at_step — id шага, на котором нажали «Пропустить» (или "unknown", если клиент не передал).',
      labelNames: ['tenant', 'tour_id', 'at_step'] as const,
    });

    // Sprints (ТЗ 2026-05-27) — счётчики и гистограммы.
    this.cyclesCreatedTotal = this.getOrCreateCounter({
      name: 'cycles_created_total',
      help: 'Создано циклов-спринтов (по виду scope: org/customer/vendor/person/department/project).',
      labelNames: ['tenant', 'scope_kind'] as const,
    });
    this.cyclesCompletedTotal = this.getOrCreateCounter({
      name: 'cycles_completed_total',
      help: 'Завершено циклов-спринтов (POST /cycles/:id/complete).',
      labelNames: ['tenant'] as const,
    });
    this.sprintHintsTotal = this.getOrCreateCounter({
      name: 'sprint_hints_total',
      help: 'Подсказки помощника по спринтам (Specialist 3-13) по виду и статусу.',
      labelNames: ['tenant', 'kind', 'status'] as const,
    });
    this.sprintHintDismissedTotal = this.getOrCreateCounter({
      name: 'sprint_hint_dismissed_total',
      help: 'Подсказки помощника по спринтам, закрытые пользователем (dismiss).',
      labelNames: ['tenant', 'kind'] as const,
    });
    this.sprintDashboardCacheHitTotal = this.getOrCreateCounter({
      name: 'sprint_dashboard_cache_hit_total',
      help: 'Redis-кэш дашборда спринта: попадание.',
      labelNames: ['tenant'] as const,
    });
    this.sprintDashboardCacheMissTotal = this.getOrCreateCounter({
      name: 'sprint_dashboard_cache_miss_total',
      help: 'Redis-кэш дашборда спринта: промах.',
      labelNames: ['tenant'] as const,
    });
    this.sprintHelperRunsTotal = this.getOrCreateCounter({
      name: 'sprint_helper_runs_total',
      help: 'Запуски воркера 3-13-sprint-helper (status: success/failed/skipped).',
      labelNames: ['tenant', 'status'] as const,
    });
    this.sprintHelperDurationSeconds = this.getOrCreateHistogram({
      name: 'sprint_helper_duration_seconds',
      help: 'Длительность одного прогона помощника по спринту.',
      labelNames: ['tenant'] as const,
      buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    });
    this.sprintReviewGenerationTotal = this.getOrCreateCounter({
      name: 'sprint_review_generation_total',
      help: 'Генерация финального отчёта спринта (sprint-review-summary): ready/failed/retried.',
      labelNames: ['tenant', 'status'] as const,
    });
    this.sprintReviewGenerationDurationSeconds = this.getOrCreateHistogram({
      name: 'sprint_review_generation_duration_seconds',
      help: 'Длительность генерации финального отчёта спринта.',
      labelNames: ['tenant'] as const,
      buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300],
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

  /**
   * Провал старта per-track audio egress (дорожка спикера не собралась).
   * ТЗ 2026-06-03 meeting-recording-reliability §117 — мониторинг egress-ёмкости:
   * рост этой метрики = дорожки теряются (даже с reconcile-бэкстопом), нужен алерт.
   */
  incTrackEgressStartFailed(args: { reason: string }): void {
    this.recordingTrackEgressFailedTotal.inc({ reason: args.reason });
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
   * Prompt-injection guard (ТЗ 2026-05-24 §4): инкрементирует счётчик при
   * каждом срабатывании regex-паттерна в пользовательском вводе.
   *
   *   - source = 'custom_prompt' (Meeting.customPrompt)
   *             | 'transcript'  (turns после ASR/диаризации)
   *             | 'chat'        (room chat сообщения).
   *   - pattern — стабильный id паттерна из `FORBIDDEN_PATTERNS`
   *     (например, 'ignore_prev', 'forget_prev_ru'). Cardinality ограничена
   *     числом паттернов × 3 source — безопасно для Prometheus.
   *
   * Не блокирует: после инкремента LLM получит текст в маркерах данных и по
   * системному правилу проигнорирует команды. Метрика — для алертов и UI.
   */
  incPromptInjectionAttempt(args: {
    source: 'custom_prompt' | 'transcript' | 'chat';
    pattern: string;
  }): void {
    this.promptInjectionAttemptTotal.inc({
      source: args.source,
      pattern: args.pattern,
    });
  }

  /**
   * Prompt invalid response (ТЗ 2026-05-24 §9 F6 — tool_use / json_schema):
   * инкрементирует на каждый невалидный ответ LLM, который заставил caller'а
   * сделать retry. Накапливается, не только при финальном fail.
   *
   *   - task_type — taskType из LlmRouter (chapters / tasks / dialog-classify ...).
   *   - model — фактическая модель (`provider:model`), которая ответила невалидно.
   *     При неизвестной модели — 'unknown'.
   *   - reason ∈ 'json_parse' | 'schema' | 'tool_missing'.
   *
   * Cardinality безопасна: ~80 taskType × ~10 моделей × 3 reasons ≈ 2400
   * рядов в худшем случае.
   */
  incPromptInvalidResponse(args: {
    taskType: string;
    model: string;
    reason: 'json_parse' | 'schema' | 'tool_missing';
  }): void {
    this.promptInvalidResponseTotal.inc({
      task_type: args.taskType,
      model: args.model,
      reason: args.reason,
    });
  }

  /** Query Understanding Волна 1 — результат извлечения плана запроса. */
  incQueryPlanExtraction(args: { result: 'applied' | 'failopen' }): void {
    this.queryPlanExtractionTotal.inc({ result: args.result });
  }
  /** Query Understanding Волна 1 — применён ли структурный фильтр в retrieval. */
  incQueryPlanRetrievalFiltered(args: { filtered: 'yes' | 'no' }): void {
    this.queryPlanRetrievalFilteredTotal.inc({ filtered: args.filtered });
  }
  /** Query Understanding Волна 1 — применённый фильтр дал пустой пул (misroute-proxy). */
  incRouterQueryClass(args: {
    class: 'list' | 'topic' | 'temporal' | 'overview' | 'fact';
  }): void {
    this.routerQueryClassTotal.inc({ class: args.class });
  }

  incRouterBothWays(args: { triggered: 'yes' | 'no' }): void {
    this.routerBothWaysTotal.inc({ triggered: args.triggered });
  }

  incQueryPlanEmptyPool(args: { result: 'empty' }): void {
    this.queryPlanEmptyPoolTotal.inc({ result: args.result });
  }

  /**
   * Task assignee resolver (ТЗ 2026-05-25 hard-participant-identification):
   * инкрементируется когда нельзя однозначно сопоставить `assigneeRaw` с
   * участником встречи.
   *
   *   - reason='duplicate_name' — в participants ≥2 host'ов с тем же display
   *     name (например, два «Сергея»). `assigneeUserId` сбрасывается в null.
   *   - reason='llm_hallucination' — LLM вернул `assigneeUserId`, которого нет
   *     в списке participants встречи. Резолвер игнорирует и сбрасывает в null.
   */
  incTaskAssigneeAmbiguous(args: {
    tenant: string;
    reason: 'duplicate_name' | 'llm_hallucination';
  }): void {
    this.taskAssigneeAmbiguousTotal.inc({
      tenant: args.tenant,
      reason: args.reason,
    });
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
   * Histogram `livekit_egress_ended_gap_seconds{request_type}` — задержка между
   * `room_finished` (Meeting.endedAt) и `egress_ended`. Наблюдение за доставкой
   * egress-вебхука; гэп растёт → egress-вебхук задерживается/теряется.
   */
  observeEgressEndedGap(requestType: string, gapSeconds: number): void {
    if (gapSeconds >= 0)
      this.livekitEgressEndedGapSeconds.observe({ request_type: requestType }, gapSeconds);
  }

  /**
   * Goals OKR v2 Фаза 3 — попытка авто-пересчёта currentValue одного KR.
   *   status='ok'        — значение изменилось, checkpoint записан;
   *   status='unchanged' — значение не изменилось (no-op);
   *   status='skipped'   — manual / manualOverride / нет конфигурации источника;
   *   status='error'     — исключение при расчёте.
   */
  incGoalKrAutoprogress(
    sourceKind: string,
    status: 'ok' | 'skipped' | 'unchanged' | 'error',
  ): void {
    this.goalKrAutoprogressTotal.inc({ source_kind: sourceKind, status });
  }

  /** Counter `goals_pulse_generated_total{tenant_top}`. */
  incGoalsPulseGenerated(args: { tenantTop: string }): void {
    this.goalsPulseGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `goals_pulse_failed_total{tenant_top, reason}`. */
  incGoalsPulseFailed(args: { tenantTop: string; reason: string }): void {
    this.goalsPulseFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  /** Counter `goals_pulse_delivered_total{tenant_top, channel}`. */
  incGoalsPulseDelivered(args: { tenantTop: string; channel: string }): void {
    this.goalsPulseDeliveredTotal.inc({
      tenant_top: args.tenantTop,
      channel: args.channel,
    });
  }

  /**
   * Диспетчеризация задачи в LlmRouter.
   *   status='success'        — провайдер вернул валидный ответ.
   *   status='fallback'       — провайдер упал, перешли к следующему.
   *   status='failed'         — все провайдеры упали.
   *   status='invalid_output' — ответ не прошёл caller-`validate` (ТЗ-3 Ф2);
   *                             трактуется как retriable → следующий провайдер.
   */
  incLlmRouterDispatch(args: {
    taskType: string;
    provider: string;
    status: 'success' | 'fallback' | 'failed' | 'invalid_output';
  }): void {
    this.llmRouterDispatchTotal.inc({
      task_type: args.taskType,
      provider: args.provider,
      status: args.status,
    });
  }

  /**
   * T7-F3 — фиксирует один LLM-вызов с попаданием в prompt cache.
   * Вызывается из AiUsageLogService.record при `cachedTokens > 0`.
   * `taskType` помогает понять, какой воркер «выигрывает» от кеширования.
   */
  incLlmCacheHit(args: {
    provider: string;
    model: string;
    taskType: string;
  }): void {
    this.llmCacheHitTotal.inc({
      provider: args.provider,
      model: args.model,
      task_type: args.taskType,
    });
  }

  /**
   * T7-F3 — суммарно прочитано из кеша токенов (cost ~0.1× input). Накапливается
   * по `provider + model` (без task_type — иначе cardinality взлетает).
   */
  addLlmCacheReadTokens(args: {
    provider: string;
    model: string;
    tokens: number;
  }): void {
    if (args.tokens <= 0) return;
    this.llmCacheReadTokensTotal.inc(
      { provider: args.provider, model: args.model },
      args.tokens,
    );
  }

  /**
   * T7-F3 — суммарно записано в кеш токенов (cost ~1.25× input для 5min TTL).
   * Если значение растёт быстрее, чем `cache_read_tokens` — значит кеш постоянно
   * инвалидируется (silent invalidator) или мы кешируем слишком волатильный
   * префикс. Слежение за отношением creation / (creation + read) — индикатор
   * качества кеширования.
   */
  addLlmCacheCreationTokens(args: {
    provider: string;
    model: string;
    tokens: number;
  }): void {
    if (args.tokens <= 0) return;
    this.llmCacheCreationTokensTotal.inc(
      { provider: args.provider, model: args.model },
      args.tokens,
    );
  }

  /**
   * Ф6 Часть 3 — фиксирует один УСПЕШНЫЙ LLM-вызов per provider.
   * Вызывается из AiUsageLogService.record при `success === true`.
   * Знаменатель для cache hit-ratio (вместе с incLlmCacheHit).
   */
  incLlmCall(args: { provider: string }): void {
    this.llmCallsTotal.inc({ provider: args.provider });
  }

  /**
   * Ф6 Часть 3 — выставляет gauge-флаг «доля cache-хитов ниже порога».
   * 1 = ниже порога (тревога), 0 = норма. Вызывается smoke-cron'ом.
   */
  setLlmCacheHitRatioBelowThreshold(args: {
    provider: string;
    below: boolean;
  }): void {
    this.llmCacheHitRatioBelowThreshold.set(
      { provider: args.provider },
      args.below ? 1 : 0,
    );
  }

  /**
   * Ф6 Часть 3 — снимок доли prompt-cache хитов по провайдерам, чьё имя
   * содержит `providerSubstring` (например 'deepseek'). Суммирует
   * `z_llm_cache_hit_total` (по всем model/task_type) и делит на суммарный
   * `z_llm_calls_total` тех же провайдеров.
   *
   * ratio === null, если total < `minTotal` (мало данных — не делаем выводов
   * на низком трафике, иначе цифра шумная).
   */
  async getLlmCacheHitRatio(
    providerSubstring: string,
    minTotal = 20,
  ): Promise<{ hits: number; total: number; ratio: number | null }> {
    const needle = providerSubstring.toLowerCase();
    const matches = (label: unknown): boolean =>
      typeof label === 'string' && label.toLowerCase().includes(needle);

    const hitSnapshot = await this.llmCacheHitTotal.get();
    let hits = 0;
    for (const v of hitSnapshot.values) {
      if (matches(v.labels.provider)) hits += v.value;
    }

    const callsSnapshot = await this.llmCallsTotal.get();
    let total = 0;
    for (const v of callsSnapshot.values) {
      if (matches(v.labels.provider)) total += v.value;
    }

    const ratio = total >= minTotal ? hits / total : null;
    return { hits, total, ratio };
  }

  /**
   * ТЗ 2026-05-25 — фиксирует один случай автоконвертации json_schema → tool
   * в DeepSeekService. Вызывается, когда caller передал
   * `responseFormat: json_schema` без `tools`, а модель — Pro (thinking-mode
   * не поддерживает strict json_schema).
   */
  incDeepseekSchemaToToolConversion(args: { model: string }): void {
    this.deepseekSchemaToToolConversionTotal.inc({ model: args.model });
  }

  /**
   * ТЗ 2026-05-25 Фаза 1 — фиксирует один случай автозамены параметра(ов)
   * для thinking-модели (DeepSeek-V4-Pro / любая «*-pro» / «*-thinking»).
   * Используется и в `DeepSeekService`, и в `OpenAiChatProtocolAdapter`.
   *
   * kind:
   *   - `schema-to-tool` — strict json_schema без tools → виртуальный tool +
   *     tool_choice='auto' + hint в user. Дублирует более узкую метрику
   *     `z_deepseek_schema_to_tool_conversion_total` для совместимости.
   *   - `strict-stripped` — strict json_schema вместе с tools → json_schema
   *     снят (оставлены только tools). Caller передал лишний параметр.
   *   - `tool-choice-relaxed` — caller передал forced `tool_choice` → 'auto'.
   */
  incLlmThinkingModelGuard(args: {
    kind: 'schema-to-tool' | 'strict-stripped' | 'tool-choice-relaxed';
    model: string;
  }): void {
    this.llmThinkingModelGuardTotal.inc({ kind: args.kind, model: args.model });
  }

  /**
   * Фаза A.4 — все 3 tier'а (primary/secondary/tertiary) упали для taskType.
   * Это критическая ситуация: ни один провайдер не отработал.
   */
  incCoreLlmNoProvider(args: { taskType: string }): void {
    this.coreLlmNoProviderTotal.inc({ task_type: args.taskType });
  }

  /**
   * LLM-вызов модели без цены — нет ни в `LlmModelPrice` (БД), ни в
   * статической `MODEL_PRICES`. costUsd молча считается = 0, расход
   * становится невидимым. > 0 → заполни цену модели в админке.
   */
  incLlmCostUnpriced(args: { provider: string; model: string }): void {
    this.llmCostUnpricedTotal.inc({ provider: args.provider, model: args.model });
  }

  /**
   * block-linker не смог распарсить вердикт LLM-арбитра после ретраев →
   * связь между блоками не создана (молчаливая деградация графа знаний).
   * Должно быть = 0; > 0 → проверь модель/формат ответа арбитра.
   */
  incKcBlockLinkerFallbackNone(args: { reason: string }): void {
    this.kcBlockLinkerFallbackNoneTotal.inc({ reason: args.reason });
  }

  /**
   * block-linker: невалидный ответ арбитра на отдельной попытке (до ретрая).
   * reason=parse — JSON-вердикт не распарсился; reason=llm_error — вызов LLM
   * упал. Считает долю «грязного» JSON per-attempt; терминальные потери (после
   * исчерпания ретраев) — в kc_block_linker_fallback_none_total.
   */
  incKcBlockLinkerInvalidJson(args: { reason: string }): void {
    this.kcBlockLinkerInvalidJsonTotal.inc({ reason: args.reason });
  }

  /**
   * entity-graph: невалидный ответ LLM-арбитра на отдельной попытке (до
   * ретрая). reason=parse — JSON не распарсился; reason=llm_error — вызов LLM
   * упал. Терминальные потери (после исчерпания ретраев) —
   * в kc_entity_graph_fallback_none_total.
   */
  incKcEntityGraphInvalidJson(args: { reason: string }): void {
    this.kcEntityGraphInvalidJsonTotal.inc({ reason: args.reason });
  }

  /**
   * entity-graph не смог распарсить вердикт LLM-арбитра после ретраев →
   * связь между сущностями не создана (молчаливая деградация графа знаний).
   * Должно быть = 0; > 0 → проверь модель/формат ответа арбитра.
   */
  incKcEntityGraphFallbackNone(args: { reason: string }): void {
    this.kcEntityGraphFallbackNoneTotal.inc({ reason: args.reason });
  }

  /**
   * Ф5 Р2 — один результат семантического дедупа задачи-черновика встречи.
   * result: 'knn_merged' | 'llm_merged' | 'kept' | 'skipped'. Optional-safe:
   * счётчик может быть не инициализирован в тестовых моках сервиса.
   */
  incTaskDedupe(args: { result: string }): void {
    this.taskDedupeTotal?.inc({ result: args.result });
  }

  incTaskDedupSuggested(args: { tenantTop: string }): void {
    this.taskDedupSuggestedTotal?.inc({ tenant_top: args.tenantTop });
  }

  incMorningTasksDigest(args: { isEmpty: boolean }): void {
    this.morningTasksDigestTotal?.inc({ is_empty: String(args.isEmpty) });
  }

  /**
   * TZ task-loop Ф2b — один исход петли закрытия задачи. outcome:
   * 'created' | 'no_match' | 'not_done' | 'embed_fail' | 'disabled' |
   * 'skipped_tracker' | 'dropped_merged' | 'no_text'. Optional-safe для тестов
   * без onModuleInit.
   */
  incTaskClosureOutcome(args: { outcome: string }): void {
    this.taskClosureOutcomeTotal?.inc({ outcome: args.outcome });
  }

  /**
   * Ф3 — один прогон синка ChatBox по scope (full/incremental/…). status:
   * 'success' | 'failed'. Optional-safe для тестов без onModuleInit.
   */
  incChatboxSync(args: { scope: string; status: 'success' | 'failed' }): void {
    this.chatboxSyncsTotal?.inc({ scope: args.scope, status: args.status });
  }

  /**
   * Ф3 — один анализ закрытой сессии чата (мост в граф). status:
   * 'success' | 'failed'.
   */
  incChatboxAnalyze(args: { status: 'success' | 'failed' }): void {
    this.chatboxAnalyzesTotal?.inc({ status: args.status });
  }

  incChatboxTasksOwnerMissing(): void {
    this.chatboxTasksOwnerMissingTotal?.inc();
  }

  /** Ф3 — текущее число pending-сессий чата, ждущих анализа (gauge). */
  setChatboxPendingSessions(count: number): void {
    this.chatboxPendingSessions?.set(count);
  }

  setChatboxStuckAnalyzing(count: number): void {
    this.chatboxStuckAnalyzing?.set(count);
  }

  /** Ф3 — unixtime последнего успешного синка ChatBox per scope (gauge). */
  setChatboxLastSyncTs(args: { scope: string; tsSeconds: number }): void {
    this.chatboxLastSyncTsSeconds?.set({ scope: args.scope }, args.tsSeconds);
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
   * ТЗ LLM cost-safety Ф2 — LLM-вызов при превышенном hard-cap бюджета.
   * `mode='observe'` — флаг enforce выключен, вызов пропущен; `mode='enforce'`
   * — вызов заблокирован (`LlmBudgetExceededError`).
   */
  incLlmBudgetExceeded(args: { mode: string }): void {
    this.llmBudgetExceededTotal.inc({ mode: args.mode });
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

  /**
   * KC-Temporal W1.1 — snapshot открытых (validUntil IS NULL) IdeaBlock'ов
   * по signal_type. Вызывается из CoreMetricsSnapshotCron.
   */
  setKcFactsOpen(args: { tenant: string; signalType: string; count: number }): void {
    this.kcFactsOpenGauge.set(
      { tenant: args.tenant, signal_type: args.signalType },
      args.count,
    );
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

  // ────────────────────── meeting-report-fast (ТЗ 2026-05-25) ──────────

  /**
   * Запуск воркера `MeetingReportFastWorker` завершён.
   * status: 'ready' — успех; 'partial' — частичная запись (например, не было
   * хотя бы одной из секций); 'failed' — упал после ретраев.
   */
  incMeetingReportFast(args: {
    tenant: string;
    status: 'ready' | 'failed' | 'partial';
  }): void {
    this.meetingReportFastTotal.inc({
      tenant: args.tenant,
      status: args.status,
    });
  }

  /** Длительность одного запуска `MeetingReportFastWorker` (секунды). */
  observeMeetingReportFastDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.meetingReportFastDurationSeconds.observe(seconds);
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

  // ──────────────── TZ-1 Фаза 0 — дневной бюджет уведомлений ──────────

  /** Counter `notification_budget_consumed_total{trigger}`. */
  incNotificationBudgetConsumed(args: { trigger: string }): void {
    this.notificationBudgetConsumedTotal.inc({ trigger: args.trigger });
  }

  /** Counter `notification_budget_blocked_total{reason}`. */
  incNotificationBudgetBlocked(args: { reason: string }): void {
    this.notificationBudgetBlockedTotal.inc({ reason: args.reason });
  }

  /** Counter `notification_deferred_to_digest_total`. */
  incNotificationDeferredToDigest(): void {
    this.notificationDeferredToDigestTotal.inc();
  }

  /** Gauge `channel_binding_coverage_ratio{tenant_top}` (0..1). */
  setChannelBindingCoverageRatio(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.channelBindingCoverageRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /** Counter `channel_binding_campaign_invited_total{tenant_top}`. */
  incChannelBindingCampaignInvited(args: { tenantTop: string }): void {
    this.channelBindingCampaignInvitedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `checkin_prompt_delivered_total{channel}`. */
  incCheckinPromptDelivered(args: { channel: string }): void {
    this.checkinPromptDeliveredTotal.inc({ channel: args.channel });
  }

  incDayReportCollected(args: { tenantTop: string }): void {
    this.dayReportCollectedTotal.inc({ tenant_top: args.tenantTop });
  }

  incDayReportBlockDroppedNoPerson(): void {
    this.dayReportBlockDroppedNoPersonTotal.inc();
  }

  incDayReportNotDoneVerifyCalls(): void {
    this.dayReportNotDoneVerifyCallsTotal.inc();
  }

  // ──────────────── TZ-1 Фаза 1 — радар клиентов под риском ───────────

  /** Counter `customer_risk_snapshots_total{level}`. */
  incCustomerRiskSnapshots(args: { level: string }): void {
    this.customerRiskSnapshotsTotal.inc({ level: args.level });
  }

  /** Counter `customer_risk_radar_failed_total{reason}`. */
  incCustomerRiskRadarFailed(args: { reason: string }): void {
    this.customerRiskRadarFailedTotal.inc({ reason: args.reason });
  }

  /** Gauge `portfolio_health_score{tenant_top}` (0..100). */
  setPortfolioHealthScore(args: { tenantTop: string; score: number }): void {
    if (!Number.isFinite(args.score)) return;
    this.portfolioHealthScore.set(
      { tenant_top: args.tenantTop },
      Math.min(100, Math.max(0, args.score)),
    );
  }

  /** Counter `portfolio_health_snapshot_total{tenant_top}`. */
  incPortfolioHealthSnapshot(args: { tenantTop: string }): void {
    this.portfolioHealthSnapshotTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `portfolio_priority_set_total{tenant_top,priority}`. */
  incPortfolioPrioritySet(args: { tenantTop: string; priority: string }): void {
    this.portfolioPrioritySetTotal.inc({
      tenant_top: args.tenantTop,
      priority: args.priority,
    });
  }

  /** Counter `customer_risk_manager_notified_total`. */
  incCustomerRiskManagerNotified(): void {
    this.customerRiskManagerNotifiedTotal.inc();
  }

  // ──────────────── TZ-1 Фаза 2 — движок рядового «Твой день» ──────────

  /** Counter `personal_daily_brief_built_total`. */
  incPersonalDailyBriefBuilt(): void {
    this.personalDailyBriefBuiltTotal.inc();
  }

  /** Counter `personal_daily_brief_delivered_total{channel}`. */
  incPersonalDailyBriefDelivered(args: { channel: string }): void {
    this.personalDailyBriefDeliveredTotal.inc({ channel: args.channel });
  }

  /** Counter `personal_daily_brief_opened_total`. */
  incPersonalDailyBriefOpened(): void {
    this.personalDailyBriefOpenedTotal.inc();
  }

  /** Counter `knows_who_match_total{found}`. */
  incKnowsWhoMatch(args: { found: 'yes' | 'no' }): void {
    this.knowsWhoMatchTotal.inc({ found: args.found });
  }

  // ──────────── B6/Ф7 (mobile-cora-exec-manager §Ф7) — exec web-push ────────

  /** Counter `z_exec_morning_push_delivered_total{channel}`. */
  incExecMorningPushDelivered(args: { channel: string }): void {
    this.execMorningPushDeliveredTotal.inc({ channel: args.channel });
  }

  // ──────────────── TZ-1 Фаза 3.A/B/C — агенты исполнения ──────────────

  /** Counter `blocker_synthesis_recurring_total{status}`. */
  incBlockerSynthesisRecurring(args: { status: string }): void {
    this.blockerSynthesisRecurringTotal.inc({ status: args.status });
  }

  /** Gauge `task_closure_reopen_rate{tenant_top}` (0..1) — task-dedup Ф3. */
  setTaskClosureReopenRate(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.taskClosureReopenRate.set(
      { tenant_top: args.tenantTop },
      Math.min(1, Math.max(0, args.value)),
    );
  }

  /** Counter `theme_silence_surfaced_total{severity}` (редизайн Ф8.2). */
  incThemeSilenceSurfaced(args: { severity: string }): void {
    this.themeSilenceSurfacedTotal.inc({ severity: args.severity });
  }

  /** Counter `promise_cascade_alert_total`. */
  incPromiseCascadeAlert(): void {
    this.promiseCascadeAlertTotal.inc();
  }

  // ──────────────── TZ-1 Фаза 4 — улучшения и знания ───────────────────

  /** Counter `ideas_top_served_total` (Ф4.A — отдача ленты идей). */
  incIdeasTopServed(): void {
    this.ideasTopServedTotal.inc();
  }

  /** Counter `idea_status_auto_advanced_total{to}` (Ф4.A — авто-морфинг статуса). */
  incIdeaStatusAutoAdvanced(args: { to: string }): void {
    this.ideaStatusAutoAdvancedTotal.inc({ to: args.to });
  }

  /** Counter `idea_status_changed_notified_total` (Ф4.A — автор уведомлён). */
  incIdeaStatusChangedNotified(): void {
    this.ideaStatusChangedNotifiedTotal.inc();
  }

  /**
   * Counter `insight_rechecked_total{reactivated}` (Ф4.B — re-check митигаций).
   * `reactivated` = 'true' если митигированный инсайт вернулся в active.
   */
  incInsightRechecked(args: { reactivated: boolean }): void {
    this.insightRecheckedTotal.inc({
      reactivated: args.reactivated ? 'true' : 'false',
    });
  }

  /** Counter `knowledge_at_risk_total{severity}` (Ф4.C — знание-под-риском). */
  incKnowledgeAtRisk(args: { severity: string }): void {
    this.knowledgeAtRiskTotal.inc({ severity: args.severity });
  }

  /** Counter `team_capacity_overload_total` (Ф4.D — перегруженные команды). */
  incTeamCapacityOverload(): void {
    this.teamCapacityOverloadTotal.inc();
  }

  /** Counter `onboarding_ramp_stalled_total` (Ф4.E — молчащие новички). */
  incOnboardingRampStalled(): void {
    this.onboardingRampStalledTotal.inc();
  }

  // ──────────────── TZ-1 Фаза 5 — месячная витрина value-recap ─────────

  /** Counter `value_recap_built_total` (Ф5 — построено месячных снимков). */
  incValueRecapBuilt(): void {
    this.valueRecapBuiltTotal.inc();
  }

  /** Counter `value_recap_delivered_total{channel}` (Ф5 — доставка владельцу). */
  incValueRecapDelivered(args: { channel: string }): void {
    this.valueRecapDeliveredTotal.inc({ channel: args.channel });
  }

  /** Counter `value_recap_opened_total` (Ф5 — владелец открыл витрину). */
  incValueRecapOpened(): void {
    this.valueRecapOpenedTotal.inc();
  }

  /** Counter `chat_v2_feedback_total{reaction}` (Ф5 — оценка ответа up|down). */
  incChatV2Feedback(args: { reaction: 'up' | 'down' }): void {
    this.chatV2FeedbackTotal.inc({ reaction: args.reaction });
  }

  /**
   * Gauge `chat_v2_answered_with_citation_total{mode}` (Ф5 — grounding-proxy,
   * НЕ «дефлекция»). Ставится по итогам агрегации `getChatUsageStats`.
   */
  setChatAnsweredWithCitation(args: { mode: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.chatV2AnsweredWithCitation.set(
      { mode: args.mode },
      Math.max(0, args.value),
    );
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

  // ────────────────────── telegram proxy (2026-05-26) ─────────────────

  /**
   * Outbound-вызов Bot API через прокси telegram.crossmark.ru.
   * outcome ∈ ok | proxy_5xx | proxy_4xx | telegram_5xx | telegram_4xx | network.
   * См. plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §1.1 п.6.
   */
  incTelegramProxyRequest(args: {
    apiMethod: string;
    outcome: 'ok' | 'proxy_5xx' | 'proxy_4xx' | 'telegram_5xx' | 'telegram_4xx' | 'network';
  }): void {
    this.telegramProxyRequestTotal.inc({
      api_method: args.apiMethod,
      outcome: args.outcome,
    });
  }

  /** Длительность outbound-вызова Bot API через прокси (секунды). */
  observeTelegramProxyRequestDuration(args: {
    apiMethod: string;
    durationSec: number;
  }): void {
    this.telegramProxyRequestDurationSeconds.observe(
      { api_method: args.apiMethod },
      args.durationSec,
    );
  }

  /**
   * Tick health-check cron'а для прокси. outcome ∈ ok | fail.
   * См. `TelegramProxyHealthCron`.
   */
  incTelegramProxyHealthCheck(args: { outcome: 'ok' | 'fail' }): void {
    this.telegramProxyHealthCheckTotal.inc({ outcome: args.outcome });
  }

  // ────────────────────── telegram bot — глобальный (β-9) ─────────────

  /**
   * β-9 — Принят webhook от глобального Telegram-бота (без `:tenantId`).
   * type ∈ {message, edited_message, unknown}.
   */
  incTelegramBotGlobalWebhookReceived(args: { type: string }): void {
    this.telegramBotGlobalWebhookReceivedTotal.inc({ type: args.type });
  }

  /**
   * β-9 — Незнакомый отправитель в глобальном Telegram-боте.
   * reason ∈ {no_binding, no_membership}.
   */
  incTelegramBotUnknownSender(args: {
    reason: 'no_binding' | 'no_membership';
  }): void {
    this.telegramBotUnknownSenderTotal.inc({ reason: args.reason });
  }

  /**
   * β-9 Phase 6 — команда `/login` в Telegram-боте.
   * outcome ∈ ok (ссылка выдана) | not_linked (отправитель не привязан к
   * аккаунту в Коре) | user_not_found (binding найден, но User удалён).
   */
  incBotLoginCommand(args: {
    outcome: 'ok' | 'not_linked' | 'user_not_found';
  }): void {
    this.botLoginCommandTotal.inc({ outcome: args.outcome });
  }

  /**
   * β-9 Phase 4 — действие super-admin в админке над глобальным
   * Telegram-ботом. Пишется по каждому успешному действию (включая чтение —
   * для compliance вместе с SuperAdminAccessLog).
   */
  incAdminTelegramBotAction(args: {
    action:
      | 'token_changed'
      | 'webhook_reset'
      | 'status_toggled'
      | 'templates_updated'
      | 'settings_read'
      | 'bindings_read';
  }): void {
    this.adminTelegramBotActionsTotal.inc({ action: args.action });
  }

  // ────────────────────── invitations + magic-link (β-9) ─────────────

  incInviteCreated(args: { hasEmail: boolean }): void {
    this.inviteCreatedTotal.inc({ has_email: String(args.hasEmail) });
  }

  incInviteAccepted(args: {
    path: 'magic_link' | 'password' | 'telegram_first';
  }): void {
    this.inviteAcceptedTotal.inc({ path: args.path });
  }

  incInviteReminderSent(args: { day: 7 | 14 }): void {
    this.inviteReminderSentTotal.inc({ day: String(args.day) });
  }

  incInviteExpired(): void {
    this.inviteExpiredTotal.inc();
  }

  incMagicLinkRequest(args: {
    outcome: 'sent' | 'rate_limited' | 'user_not_found';
  }): void {
    this.magicLinkRequestTotal.inc({ outcome: args.outcome });
  }

  incMustChangePasswordBlock(args: { path: string }): void {
    this.mustChangePasswordBlockTotal.inc({ path: args.path });
  }

  incTochkaWebhookReplay(args: {
    reason: 'expired' | 'not_before' | 'signature' | 'missing_iat' | 'other';
  }): void {
    this.tochkaWebhookReplayTotal.inc({ reason: args.reason });
  }

  incReferralSelfReferralDenied(): void {
    this.referralSelfReferralDeniedTotal.inc();
  }

  /**
   * commercial-reliability pack (2026-05-30) — повторный клик по другой
   * реферальной ссылке отброшен first-touch гардом (Org.pendingAttributionSlug
   * IS NOT NULL → updateMany.count === 0).
   */
  incReferralAttributionFirstTouchLocked(): void {
    this.referralAttributionFirstTouchLockedTotal.inc();
  }

  /**
   * commercial-reliability pack (2026-05-30, Фаза 3) — хост переименовал гостя
   * встречи (PATCH /meetings/:id/participants/:pid).
   */
  incParticipantRenamed(): void {
    this.participantRenamedTotal.inc();
  }

  // ─────── billing/referrals observability (Фаза 4 commercial pack) ────

  /** Billing — Invoice создан. */
  incBillingInvoiceCreated(args: {
    tenantTop: string;
    kind: 'acquiring' | 'bank' | 'manual';
  }): void {
    this.billingInvoiceCreatedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  /** Billing — Invoice перешёл в paid (закрыта оплата). */
  incBillingInvoicePaid(args: {
    tenantTop: string;
    kind: 'acquiring' | 'bank' | 'manual';
  }): void {
    this.billingInvoicePaidTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  /** Billing — Subscription успешно продлена. */
  incBillingSubscriptionRenewed(args: { tenantTop: string; tier: string }): void {
    this.billingSubscriptionRenewedTotal.inc({
      tenant_top: args.tenantTop,
      tier: args.tier,
    });
  }

  /** Billing — Subscription отменена. */
  incBillingSubscriptionCancelled(args: {
    tenantTop: string;
    reason: 'user_cancelled' | 'payment_failed' | 'manual_admin';
  }): void {
    this.billingSubscriptionCancelledTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  /** Billing — входящий webhook от провайдера (Точка). */
  incBillingWebhookReceived(args: {
    provider: 'tochka';
    status: 'ok' | 'sig_fail' | 'replay' | 'invalid_payload';
  }): void {
    this.billingWebhookReceivedTotal.inc({
      provider: args.provider,
      status: args.status,
    });
  }

  /** Billing — длительность исходящего HTTP-запроса в провайдер. */
  observeBillingProviderRequest(args: {
    provider: 'tochka';
    method: string;
    status: 'ok' | 'error';
    durationSeconds: number;
  }): void {
    this.billingProviderRequestDurationSeconds.observe(
      {
        provider: args.provider,
        method: args.method,
        status: args.status,
      },
      args.durationSeconds,
    );
  }

  /** Referral — клик по реф-ссылке (beacon на лендинге). */
  incReferralClick(args: { partnerTop: string }): void {
    this.referralClickTotal.inc({ partner_top: args.partnerTop });
  }

  /** Referral — Org успешно атрибутирована к рефералу (первая first-touch). */
  incReferralSignup(args: { partnerTop: string }): void {
    this.referralSignupTotal.inc({ partner_top: args.partnerTop });
  }

  /** Referral — ReferralPayout(pending) создан cron-ом 10-го числа. */
  incReferralPayoutCreated(args: { cronRunDate: string }): void {
    this.referralPayoutCreatedTotal.inc({ cron_run_date: args.cronRunDate });
  }

  /** Referral — суммарный объём partner-выплат в рублях. */
  incReferralPayoutAmountRub(amountRub: number): void {
    if (amountRub > 0 && Number.isFinite(amountRub)) {
      this.referralPayoutAmountRubTotal.inc(amountRub);
    }
  }

  /**
   * referrals-cabinet-revamp §8.3a — первый показ промо-полосы
   * `<ReferralPromoStrip />` за сессию пользователя (фронт сам делает
   * dedup по `sessionStorage`, бэк только инкрементит).
   */
  incReferralPromoImpression(args: { role: 'owner' | 'member' }): void {
    this.referralPromoImpressionTotal.inc({ role: args.role });
  }

  /** referrals-cabinet-revamp §8.3a — клик «Получить ссылку» в промо-полосе. */
  incReferralPromoClick(args: { role: 'owner' | 'member' }): void {
    this.referralPromoClickTotal.inc({ role: args.role });
  }

  /** referrals-cabinet-revamp §8.3a — клик «×» (закрыть) в промо-полосе. */
  incReferralPromoDismissed(args: { role: 'owner' | 'member' }): void {
    this.referralPromoDismissedTotal.inc({ role: args.role });
  }

  /** audit С3 — listener BillingEvent упал, side-effect не выполнен. */
  incBillingEmitFailed(args: { event: string }): void {
    this.billingEmitFailedTotal.inc({ event: args.event });
  }

  /** audit С23 — concierge получил ошибку при чтении конфига. */
  incConciergeConfigError(args: {
    reason: 'dialog_layer_enabled' | 'tenant_scope' | 'other';
  }): void {
    this.conciergeConfigErrorTotal.inc({ reason: args.reason });
  }

  incReferralInnMismatch(args: {
    reason: 'lookup_inn_mismatch' | 'director_name_mismatch';
  }): void {
    this.referralInnMismatchTotal.inc({ reason: args.reason });
  }

  incMagicLinkConsume(args: {
    outcome: 'ok' | 'expired' | 'already_used' | 'invalid';
  }): void {
    this.magicLinkConsumeTotal.inc({ outcome: args.outcome });
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

  // ────────────────────── zero-button bot inbound (β-1 rip-out) ──────

  /** Нормализованный inbound в Telegram/MAX-боты (по типу контента). */
  incBotInbound(args: {
    channel: 'telegram_bot' | 'max_bot';
    kind:
      | 'text'
      | 'voice'
      | 'document'
      | 'start_command'
      | 'link_code'
      | 'other'
      // ТЗ 2026-05-29 telegram-self-initiated-checkins — резервируем kind
      // для будущего использования, чтобы можно было считать inbound
      // отдельно от обычного text. Сейчас не инкрементируется (Phase 2);
      // включение — в Phase 4/5 при подсчёте saved-успехов.
      | 'daily_checkin_self';
  }): void {
    this.botInboundTotal.inc({ channel: args.channel, kind: args.kind });
  }

  /** Длительность ASR для voice-сообщения, отправленного боту. */
  observeBotVoiceAsrDuration(args: {
    channel: 'telegram_bot' | 'max_bot';
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.botVoiceAsrDurationSeconds.observe(
      { channel: args.channel },
      args.seconds,
    );
  }

  /**
   * Результат intent-классификации входящего текста бота (LLM или эвристика).
   * ТЗ 2026-06-10 §2 Ф4 — добавлены значения `task` / `show_tasks` (гейт
   * намерения перед созданием задачи): теперь метрика показывает РАСПРЕДЕЛЕНИЕ
   * всех терминальных намерений бота, а не только chat_query/free_note.
   */
  incBotIntentClassified(args: {
    channel: 'telegram_bot' | 'max_bot';
    intent: 'chat_query' | 'free_note' | 'task' | 'show_tasks';
    source: 'llm' | 'heuristic';
  }): void {
    this.botIntentClassifiedTotal.inc({
      channel: args.channel,
      intent: args.intent,
      source: args.source,
    });
  }

  /**
   * ТЗ 2026-05-29 — счётчик распознавания plan/report в bot-адаптере.
   * source ∈ {llm, fallback_heuristic, fallback_factual_at_llm_fail}.
   */
  incBotCheckinIntentClassifier(args: {
    channel: 'telegram_bot' | 'max_bot';
    kind: 'morning' | 'evening';
    source: 'llm' | 'fallback_heuristic' | 'fallback_factual_at_llm_fail';
  }): void {
    this.botCheckinIntentClassifierTotal.inc({
      channel: args.channel,
      kind: args.kind,
      source: args.source,
    });
  }

  /**
   * ТЗ 2026-05-29 — outcome обработки self-initiated daily_checkin_self в
   * CheckinResponseHandler.processSelfInitiated (Phase 4).
   */
  incBotDailyCheckinSelf(args: {
    channel: 'telegram_bot' | 'max_bot';
    kind: 'morning' | 'evening';
    outcome:
      | 'saved'
      | 'low_parser_confidence_curator_review'
      | 'no_person'
      | 'no_membership'
      | 'error';
  }): void {
    this.botDailyCheckinSelfTotal.inc({
      channel: args.channel,
      kind: args.kind,
      outcome: args.outcome,
    });
  }

  // ────── tracker Phase 4 РФ — Telegram-бот для задач (Wave 3) ────────

  /** Telegram-бот: задача создана (intake или сразу Issue через auto-triage). */
  incTelegramTasksCreated(args: {
    tenantTop: string;
    status: 'created' | 'auto_created' | 'failed' | 'intake_only';
  }): void {
    this.telegramTasksCreatedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  /** Telegram-бот: voice → ASR → текст для последующего парсинга. */
  incTelegramVoiceTranscribed(args: {
    tenantTop: string;
    kind: 'create_task' | 'forward_to_task';
  }): void {
    this.telegramVoiceTranscribedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  /** Telegram-бот: forward → IntakeIssue. */
  incTelegramForwards(args: {
    tenantTop: string;
    status: 'created' | 'auto_created' | 'failed' | 'intake_only';
  }): void {
    this.telegramForwardsTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  /** Telegram-бот: утренний дайджест задач. */
  incTelegramDigestSent(args: {
    tenantTop: string;
    result: 'sent' | 'empty' | 'dedup_skip' | 'error' | 'skipped_non_working';
  }): void {
    this.telegramDigestSentTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /**
   * Action Center B3 — повторяющееся Telegram-напоминание о
   * pending-подтверждениях. result: sent | empty | dedup | error.
   */
  incPendingReminderSent(args: {
    tenantTop: string;
    result: 'sent' | 'empty' | 'dedup' | 'error';
  }): void {
    this.pendingReminderSentTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /** Telegram-бот: reply классифицирован LLM. */
  incTelegramReplyClassified(args: {
    tenantTop: string;
    kind: 'status_command' | 'comment' | 'new_task' | 'unknown';
  }): void {
    this.telegramReplyClassifiedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
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

  /** A1 — провизорная AI-канонизация критического типа (trustTier=provisional). */
  incCurationProvisional(args: { resourceType: string }): void {
    this.curationProvisionalTotal.inc({ resource_type: args.resourceType });
  }

  /** A1 — авто/провизорное решение попало в аудит-выборку. */
  incCurationAuditSample(args: { resourceType: string }): void {
    this.curationAuditSampleTotal.inc({ resource_type: args.resourceType });
  }

  /** A1 — вердикт AI-судьи canonical-verify (decision × consensus_type). */
  incCurationVerifierVerdict(args: {
    decision: string;
    consensusType: string;
  }): void {
    this.curationVerifierVerdictTotal.inc({
      decision: args.decision,
      consensus_type: args.consensusType,
    });
  }

  incCurationGrayZoneJudged(args: { outcome: 'canonicalized' | 'to_human' }): void {
    this.curationGrayZoneJudgedTotal.inc({ outcome: args.outcome });
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

  /**
   * Autonomy W1 — исход одного конфликта в ночном LLM-арбитре конфликтов
   * (ConflictArbiterCron): verdict дебата × outcome
   * (auto_resolved | left_open | error).
   */
  incConflictArbiter(args: {
    verdict: string;
    outcome: 'auto_resolved' | 'left_open' | 'error';
  }): void {
    this.conflictArbiterTotal.inc({
      verdict: args.verdict,
      outcome: args.outcome,
    });
  }

  /** Карточка-кандидат на stale (probe владельцу). */
  incCurationStale(args: { resourceType: string }): void {
    this.curationStaleDetectedTotal.inc({ resource_type: args.resourceType });
  }

  // ─────────── Action Center B5 «оживление expiresAt» (2026-06-02) ───────────

  /** Pending CurationItem закрыт по истечении expiresAt. */
  incCurationItemExpired(args: { resourceType: string }): void {
    this.curationItemExpiredTotal.inc({ resource_type: args.resourceType });
  }

  /** Возраст CurationItem от createdAt до истечения (секунды, по level). */
  observeCurationItemAge(args: { level: string; seconds: number }): void {
    this.curationItemAgeSeconds.observe({ level: args.level }, args.seconds);
  }

  /** A2 — сработал kill-switch (провизорный путь для типа отключён). */
  incCurationKillSwitch(args: { resourceType: string }): void {
    this.curationKillSwitchTotal.inc({ resource_type: args.resourceType });
  }

  /** A2 — авто-подстройка autoThresholdByType (direction ∈ 'up' | 'down'). */
  incCurationAutotuneAdjustment(args: {
    resourceType: string;
    direction: 'up' | 'down';
  }): void {
    this.curationAutotuneAdjustmentTotal.inc({
      resource_type: args.resourceType,
      direction: args.direction,
    });
  }

  // ────────────────────── curation wave 2 (SBA α-4 wave 2) ────────────

  /** Установить текущее число открытых слотов (gauge) для конкретного card_type. */
  setCompletenessSlotsOpen(args: { cardType: string; value: number }): void {
    if (args.value < 0) return;
    this.completenessSlotsOpenTotal.set({ card_type: args.cardType }, args.value);
  }

  /** Counter: слот закрыт (auto или manual). */
  incCompletenessSlotsFilled(args: { cardType: string }): void {
    this.completenessSlotsFilledTotal.inc({ card_type: args.cardType });
  }

  /** Counter: ConsistencyChecker нашёл нарушение (rule ∈ R1..R6). */
  incConsistencyViolation(args: { rule: string }): void {
    this.consistencyViolationsTotal.inc({ rule: args.rule });
  }

  /** Histogram: длительность прохода ConsistencyCheckerCron, секунды. */
  observeConsistencyCheckerDuration(seconds: number): void {
    if (seconds < 0) return;
    this.consistencyCheckerDurationSeconds.observe(seconds);
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

  /**
   * Ф3 МТЗ «разблокировка конвейера» (баг #18) — хендлер специалиста сделал
   * ранний skip-return (блок не найден / чужой тенант / не canonical /
   * signalType вне области). Отдельный counter, чтобы skip больше не
   * сливался с success в duration-метрике.
   */
  incCoreSpecialistSkipped(args: { specialist: string; reason: string }): void {
    this.coreSpecialistSkippedTotal.inc({
      specialist: args.specialist,
      reason: args.reason,
    });
  }

  incRegulationScopeUnresolved(args: { tenant: string }): void {
    this.regulationScopeRoleUnresolvedTotal.inc({ tenant: args.tenant });
  }

  incRegulationOwnerUnresolved(args: { tenant: string }): void {
    this.regulationOwnerHintUnresolvedTotal.inc({ tenant: args.tenant });
  }

  /**
   * Agent-chain overhaul Фаза 0a (2026-06-07) — расхождение материализации
   * графа: у встречи есть блоки с signalType (decision/idea), а
   * соответствующей записи (Decision/Idea) нет. Эмитит cron
   * graph-materialization-verify по каждому gap.
   */
  incKcMaterializationGap(args: { type: string }): void {
    this.kcMaterializationGapTotal.inc({ type: args.type });
  }

  /**
   * Agent-chain overhaul Фаза 4.2 (2026-06-07) — детерминированная авто-привязка
   * Goal↔Theme (GoalTheme source='ai'). Эмитит GoalThemeLinkerService по каждой
   * реально созданной связи. method ∈ provenance | comention.
   */
  incGoalThemeAutolink(args: { method: string }): void {
    this.goalThemeAutolinkTotal.inc({ method: args.method });
  }

  /**
   * Agent-chain overhaul Фаза 4.1 (2026-06-08) — LLM-привязка задач встречи к
   * AI-цели (`goal-task-link`, DEFAULT OFF). Эмитит GoalTaskLinkerService по
   * каждой задаче-вердикту. result ∈ linked | rejected | fallback | skipped.
   * optional-safe (?.): сервис инжектит метрику как @Optional() — мок/worker
   * могут не иметь.
   */
  incGoalTaskLink(args: { result: string }): void {
    this.goalTaskLinkTotal.inc({ result: args.result });
  }

  /**
   * Ф5 МТЗ «разблокировка конвейера» — провал записи типизированной сущности
   * группы Б (Process/Regulation/Policy/Tool/Metric/Decision) в block-ingest.
   * reason ∈ age_unavailable | validation_error | idempotent_skip | other.
   * age_unavailable — системный отказ графа (cypher() не резолвится), он
   * блокирует пометку RawEvent='ingested' (job уходит в failed + ретрай).
   */
  incTypedEntityFailed(args: { type: string; reason: string }): void {
    this.kcTypedEntityFailedTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  /**
   * Ф1 (knowledge-access) — инкремент субъект-атрибуции автора знания.
   * via ∈ participant | userId | personId | email | name | none.
   */
  incSubjectAttribution(args: { via: string }): void {
    this.kcSubjectAttributionTotal.inc({ via: args.via });
  }

  /**
   * Ф4 (knowledge-access) — shadow-режим: сколько блоков было бы отфильтровано
   * гейтом доступа (по поверхности). Сверка перед переводом в enforce.
   */
  incAccessShadowDiff(args: { surface: string }, count = 1): void {
    if (count > 0) this.kcAccessShadowDiffTotal.inc({ surface: args.surface }, count);
  }

  /**
   * Ф4 (knowledge-access) — enforce-режим: сколько блоков исключено гейтом
   * доступа (по поверхности).
   */
  incAccessDenied(args: { surface: string }, count = 1): void {
    if (count > 0) this.kcAccessDeniedTotal.inc({ surface: args.surface }, count);
  }

  /**
   * Ф7 МТЗ «разблокировка конвейера» (баг #1/#8) — провал моста
   * `ingestMeeting` (analyze.worker → MeetingIngestAdapter). reason ∈
   * source_inactive | no_merged_transcript | without_tenant | quota_exceeded |
   * other. Только reason в label (низкая кардинальность); tenantId/meetingId —
   * в лог, не в метку.
   */
  incIngestFailed(args: { reason: string }): void {
    this.meetingIngestFailedTotal.inc({ reason: args.reason });
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

  incCorePartialLoss(args: { reason: string; count?: number }): void {
    this.corePartialLossTotal.inc({ reason: args.reason }, args.count ?? 1);
  }

  incStrategicAlignmentParseSkip(args: { reason: string }): void {
    this.strategicAlignmentParseSkipTotal.inc({ reason: args.reason });
  }

  incRawEventRecoveryReenqueued(count = 1): void {
    this.rawEventRecoveryReenqueuedTotal.inc(count);
  }

  incRawEventRecoveryDeadLettered(count = 1): void {
    this.rawEventRecoveryDeadLetteredTotal.inc(count);
  }

  incBlockWithoutEvidence(args: { reason: string }): void {
    this.blockWithoutEvidenceTotal.inc({ reason: args.reason });
  }

  incRiskEdge(args: { relation: string; outcome: string }): void {
    this.riskEdgeTotal.inc({ relation: args.relation, outcome: args.outcome });
  }

  incRagAbstain(args: { mode: string }): void {
    this.ragAbstainTotal.inc({ mode: args.mode });
  }

  /**
   * SBA α-7 wave 2 — выставить gauge `process_templates_total{tenant_top, status}`.
   * tenant_top — нормализованный (top-100 + 'other'), нормализация на caller'е.
   */
  setProcessTemplatesTotal(args: {
    tenantTop: string;
    status: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.processTemplatesTotal.set(
      { tenant_top: args.tenantTop, status: args.status },
      args.value,
    );
  }

  /** SBA α-7 wave 2 — выставить gauge среднего completeness активных templates в Org. */
  setProcessTemplateCompletenessAvg(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (args.value < 0 || args.value > 1) return;
    this.processTemplateCompletenessAvg.set(
      { tenant_top: args.tenantTop },
      args.value,
    );
  }

  /**
   * SBA α-7 wave 2 — инкремент счётчика результата extract-батча
   * process-detector. result ∈ new | updated | skipped.
   */
  incProcessDetectorExtraction(args: {
    tenantTop: string;
    result: 'new' | 'updated' | 'skipped';
  }): void {
    this.processDetectorExtractionsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /** SBA α-7 wave 2 — наблюдение длительности одного LLM-extract-вызова. */
  observeProcessTemplateExtractDuration(seconds: number): void {
    if (seconds < 0) return;
    this.processTemplateExtractDurationSeconds.observe(seconds);
  }

  /**
   * SBA γ-3 — выставить gauge `cross_functional_processes_total{tenant_top}`.
   * tenant_top нормализован (top-100 + 'other'), нормализация на caller'е.
   */
  setCrossFunctionalProcessesTotal(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.crossFunctionalProcessesTotal.set(
      { tenant_top: args.tenantTop },
      args.value,
    );
  }

  /**
   * SBA γ-3 — выставить gauge `cross_functional_friction_active_total{tenant_top, severity}`.
   * severity ∈ 'low' | 'medium' | 'high' (cardinality-safe).
   */
  setCrossFunctionalFrictionActiveTotal(args: {
    tenantTop: string;
    severity: 'low' | 'medium' | 'high';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.crossFunctionalFrictionActiveTotal.set(
      { tenant_top: args.tenantTop, severity: args.severity },
      args.value,
    );
  }

  /**
   * SBA γ-3 — observe время от created до resolved для CrossFunctionalFrictionReport.
   * Используется при POST friction/:id/resolve.
   */
  observeCrossFunctionalFrictionResolutionTime(args: {
    tenantTop: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.crossFunctionalFrictionResolutionTimeSeconds.observe(
      { tenant_top: args.tenantTop },
      args.seconds,
    );
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

  // ─────────────────────── KC-Temporal W1.2 — FactSupersedeService ──────
  /** Verdict от LLM или skip_* до LLM-вызова. */
  incKcFactSupersedeVerdict(args: {
    verdict:
      | 'unrelated'
      | 'extends'
      | 'contradicts'
      | 'supersedes'
      | 'skip_no_candidates'
      | 'skip_not_fact_signal'
      | 'skip_race_lost'
      | 'skip_llm_error';
  }): void {
    this.kcFactSupersedeVerdictsTotal.inc({ verdict: args.verdict });
  }

  /** Длительность одного processNewBlock в миллисекундах. */
  observeKcFactSupersedeLatencyMs(ms: number): void {
    if (ms < 0) return;
    this.kcFactSupersedeLatencyMs.observe(ms);
  }

  // ─────────────────────── KC-Temporal W1.5 — EntityResolutionService ──
  /** Каким путём отрезолвилась сущность в findOrCreateEntity.
   *  W3.4 добавил путь `strong_id` (резолв через ИНН/ОГРН/email/domain/phone). */
  incKcEntityResolvePath(args: {
    path: 'exact' | 'knn' | 'create' | 'cache_hit' | 'strong_id';
  }): void {
    this.kcEntityResolvePathTotal.inc({ path: args.path });
  }

  /** Длительность одного findOrCreateEntity в миллисекундах. */
  observeKcEntityResolveLatencyMs(ms: number): void {
    if (ms < 0) return;
    this.kcEntityResolveLatencyMs.observe(ms);
  }

  // ─────────────────────── KC-Temporal W3.5 — ProjectionRebuilderService ──
  /**
   * Инкремент счётчика поставленных rebuild-jobs (по типу проекции).
   * Вызывается из ProjectionRebuilderService после успешного enqueue.
   */
  incKcProjectionRebuild(args: {
    type:
      | 'decision'
      | 'insight'
      | 'idea'
      | 'card'
      | 'regulation'
      | 'process'
      | 'policy'
      | 'skill_trait'
      | 'process_template'
      | 'experiment';
  }): void {
    this.kcProjectionRebuildTotal.inc({ type: args.type });
  }

  /**
   * Lag в миллисекундах между событием `idea_block.updated` и моментом
   * enqueue rebuild-job'а (per projection). Учитывает только пред-обработку,
   * не включает дебаунс.
   */
  observeKcProjectionRebuildLagMs(ms: number): void {
    if (ms < 0) return;
    this.kcProjectionRebuildLagMs.observe(ms);
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

  // ────────────────────── experiments (SBA β-6) ──────────────────────

  /**
   * SBA β-6 — выставить gauge числа экспериментов на (tenant_top × status).
   * Вызывается из `experiment-status-resolver.cron` после прохода по Org.
   */
  setExperimentsTotal(args: {
    tenantTop: string;
    status: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.experimentsTotal.set(
      { tenant_top: args.tenantTop, status: args.status },
      args.value,
    );
  }

  /** SBA β-6 — наблюдение длительности running-эксперимента в днях. */
  observeExperimentRunningDurationDays(args: {
    tenantTop: string;
    days: number;
  }): void {
    if (args.days < 0) return;
    this.experimentsRunningDurationDays.observe(
      { tenant_top: args.tenantTop },
      args.days,
    );
  }

  /** SBA β-6 — инкремент счётчика извлечённых уроков. */
  incExperimentLessonsExtracted(args: {
    tenantTop: string;
    count: number;
  }): void {
    if (args.count <= 0) return;
    this.experimentsLessonsExtractedTotal.inc(
      { tenant_top: args.tenantTop },
      args.count,
    );
  }

  /** SBA β-6 — итог одного прогона experiment-detector worker. */
  incExperimentDetectorRun(args: {
    tenantTop: string;
    result: 'created' | 'updated' | 'skipped' | 'error';
  }): void {
    this.experimentDetectorRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
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

  /**
   * W2 autonomy (2026-06-12) — исход «лестницы владельца» (OwnerResolver)
   * для missing_owner-триггеров: auto | ambiguous | none.
   */
  incOwnerResolution(args: { outcome: 'auto' | 'ambiguous' | 'none' }): void {
    this.ownerResolutionTotal.inc({ outcome: args.outcome });
  }

  /**
   * Ф5/Ф6 assistant-channels (2026-06-12) — исход одного хода помощника в
   * канале (AssistantChannelBridge): ok | error | quota | confirm_hold |
   * handler_error.
   */
  incAssistantTurn(args: {
    outcome: 'ok' | 'error' | 'quota' | 'confirm_hold' | 'handler_error';
  }): void {
    this.assistantTurnTotal.inc({ outcome: args.outcome });
  }

  /** Probe истёк без ответа. */
  incProbeExpired(): void {
    this.probeExpiredTotal.inc();
  }

  /**
   * SBA β-5 closing-loop — probe закрыт ответом пользователя.
   * `source` ∈ {in_app|telegram_bot|max_bot|email_smtp|api|unknown}.
   * `tenant_top` — top-100 тенантов либо `other` для контроля cardinality
   * (нормализация — на стороне caller'а).
   */
  incProbeClosed(args: { tenantTop: string; source: string }): void {
    this.probeClosedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
    });
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

  /**
   * Agents v2 Фаза 0.1 — ответ на probe классифицирован LLM-арбитром.
   * `confidence_bucket` ∈ high (≥0.85) | medium (≥0.5) | low (<min).
   */
  incProbeResponseClassified(args: {
    confidence_bucket: 'high' | 'medium' | 'low';
  }): void {
    this.probeResponseClassifiedTotal.inc({
      confidence_bucket: args.confidence_bucket,
    });
  }

  /**
   * Agents v2 Фаза 0.1 — ответ на probe признан непонятным
   * (confidence < min). `originalReason` — reason эмиттера, чтобы видеть,
   * какие probe чаще получают «мусорный» ответ.
   */
  incProbeResponseUnclear(args: { originalReason: string }): void {
    this.probeResponseUnclearTotal.inc({
      original_reason: args.originalReason,
    });
  }

  /**
   * Probe Фаза 5 — исход probe (answered|ignored) по reason. Калибровочный
   * сигнал для будущего LLM-judge ценности вопроса (Фаза 2).
   */
  incProbeOutcome(args: {
    outcome: 'answered' | 'ignored';
    reason: string;
  }): void {
    this.probeOutcomeTotal.inc({ outcome: args.outcome, reason: args.reason });
  }

  incProbeDialogTransition(args: { from: string; to: string }): void {
    this.probeDialogTransitionTotal.inc({ from: args.from, to: args.to });
  }

  incProbeDialogOutcome(args: {
    outcome: 'applied' | 'escalated_to_human' | 'abandoned';
  }): void {
    this.probeDialogOutcomeTotal.inc({ outcome: args.outcome });
  }

  incProbeDialogDegraded(): void {
    this.probeDialogDegradedTotal.inc({ reason: 'classify_failed' });
  }

  /**
   * Probe Фаза 2 (2026-06-17) — вердикт LLM-судьи качества формулировки
   * probe-вопроса: ok (вопрос полноценный, шлём как есть) | rewritten (взят
   * регенерат судьи) | kept_on_fail (судья упал / невалидный rewrite →
   * отправлен исходный, best-effort).
   */
  incProbeQualityJudged(args: {
    verdict: 'ok' | 'rewritten' | 'kept_on_fail';
  }): void {
    this.probeQualityJudgedTotal.inc({ verdict: args.verdict });
  }

  incProbeValueGate(args: { verdict: 'skip' | 'ask' }): void {
    this.probeValueGateTotal.inc({ verdict: args.verdict });
  }

  incSubjectMemoryRuleExtracted(args: { kind: string }): void {
    this.subjectMemoryRuleExtractedTotal.inc({ kind: args.kind });
  }

  incTaskAssigneeClarify(args: { outcome: string }): void {
    this.taskAssigneeClarifyTotal.inc({ outcome: args.outcome });
  }

  incCompanySummaryCompile(args: { result: string }): void {
    this.companySummaryCompileTotal.inc({ result: args.result });
  }

  incRoutingSuggestion(args: { matchPath: string }): void {
    this.routingSuggestionTotal.inc({ match_path: args.matchPath });
  }

  incRoutingSuggestionAccepted(): void {
    this.routingSuggestionAcceptedTotal.inc();
  }

  incRoutingNoCandidate(): void {
    this.routingNoCandidateTotal.inc();
  }

  incTaskSkillRoutingAssigned(args: { path: 'meeting' | 'intake' }): void {
    this.taskSkillRoutingAssignedTotal.inc({ path: args.path });
  }

  incCompanyCapsuleInjected(args: { surface: string }): void {
    this.companyCapsuleInjectedTotal.inc({ surface: args.surface });
  }

  incSubjectMemoryProbeSuppressed(args: { reason: string }): void {
    this.subjectMemoryProbeSuppressedTotal.inc({ reason: args.reason });
  }

  incSubjectMemoryRuleActivated(): void {
    this.subjectMemoryRuleActivatedTotal.inc();
  }

  incSubjectMemoryRuleRolledBack(args: { cause: string }): void {
    this.subjectMemoryRuleRolledBackTotal.inc({ cause: args.cause });
  }

  incSubjectMemoryApply(args: { status: string }): void {
    this.subjectMemoryApplyTotal.inc({ status: args.status });
  }

  incSubjectMemoryPendingSwept(args: { count: number }): void {
    this.subjectMemoryPendingSweptTotal.inc(args.count);
  }

  // ── Agents v2 Фаза B1 (2026-05-30) — AutoRule extract ────────────────

  /**
   * Запись PromptFeedback. `hasEdit='false'` при первом сохранении
   * (originalOutput только); `'true'` при update (editedOutput пришёл).
   */
  incPromptFeedback(args: { promptKey: string; hasEdit: 'true' | 'false' }): void {
    this.promptFeedbackTotal.inc({
      prompt_key: args.promptKey,
      has_edit: args.hasEdit,
    });
  }

  /** Каждое новое PromptRule, созданное AutoRuleExtractorService. */
  incAutoruleExtracted(args: { promptKey: string; ruleType: string }): void {
    this.autoruleExtractedTotal.inc({
      prompt_key: args.promptKey,
      rule_type: args.ruleType,
    });
  }

  /** Snapshot gauge — кол-во правил по (prompt_key × status × source). */
  setAutoruleRules(args: {
    promptKey: string;
    status: string;
    source: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.autoruleRulesTotal.set(
      {
        prompt_key: args.promptKey,
        status: args.status,
        source: args.source,
      },
      args.value,
    );
  }

  /** Нажатие админом «Заблокировать» (status=overridden_by_admin, sticky). */
  incAutoruleOverridden(args: { promptKey: string }): void {
    this.autoruleOverriddenTotal.inc({ prompt_key: args.promptKey });
  }

  // ── Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer ──

  /**
   * Counter `z_concierge_prm_agreement_total{agreed}` — каждый shadow-scored
   * step. `agreed='true'` если top-1 LLM == top-1 PRM, иначе `'false'`.
   */
  incConciergePrmAgreement(args: { agreed: 'true' | 'false' }): void {
    this.conciergePrmAgreementTotal.inc({ agreed: args.agreed });
  }

  /**
   * Counter `z_concierge_prm_llm_chose_rank_total{rank}` — ранг LLM-выбора
   * в PRM-сортировке. `rank ∈ '1'|'2'|'3'|'other'` (other = >3).
   */
  incConciergePrmLlmRank(args: { rank: '1' | '2' | '3' | 'other' }): void {
    this.conciergePrmLlmChoseRankTotal.inc({ rank: args.rank });
  }

  /**
   * Counter `z_concierge_prm_cost_usd_total{tenant_top}` — кумулятивная
   * стоимость PRM-вызовов в USD. costUsd ≥ 0; отрицательные/NaN игнорируются.
   */
  incConciergePrmCost(args: { tenantTop: string; costUsd: number }): void {
    if (!Number.isFinite(args.costUsd) || args.costUsd < 0) return;
    this.conciergePrmCostUsdTotal.inc(
      { tenant_top: args.tenantTop },
      args.costUsd,
    );
  }

  /**
   * Histogram `z_concierge_prm_score_distribution{tool_name}` — распределение
   * PRM-скоров (0..1) кандидатов по toolName. Скоры вне [0,1] клампятся.
   */
  observeConciergePrmScore(args: { toolName: string; score: number }): void {
    if (!Number.isFinite(args.score)) return;
    const clamped = Math.min(Math.max(args.score, 0), 1);
    this.conciergePrmScoreDistribution.observe(
      { tool_name: args.toolName.slice(0, 64) },
      clamped,
    );
  }

  // ── Agents v2 Фаза C1 (2026-05-30) — PracticeSkill ──────────────────

  /**
   * Gauge `z_practice_skills_total{tenant_top,scope,status}` — обновляется
   * snapshot-cron'ом `PracticeSkillEvaluatorCron`.
   */
  setPracticeSkillsTotal(args: {
    tenantTop: string;
    scope: 'person' | 'role' | 'org';
    status: 'shadow' | 'active' | 'archived' | 'deprecated';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.practiceSkillsTotal.set(
      {
        tenant_top: args.tenantTop.slice(0, 64),
        scope: args.scope,
        status: args.status,
      },
      args.value,
    );
  }

  /** Counter `z_practice_skills_extracted_total{scope}` — каждый новый skill. */
  incPracticeSkillsExtracted(args: { scope: 'person' | 'role' | 'org' }): void {
    this.practiceSkillsExtractedTotal.inc({ scope: args.scope });
  }

  /** Counter `z_practice_skills_promoted_total` — evaluator promote. */
  incPracticeSkillsPromoted(): void {
    this.practiceSkillsPromotedTotal.inc();
  }

  /** Counter `z_practice_skills_archived_total` — evaluator archive. */
  incPracticeSkillsArchived(): void {
    this.practiceSkillsArchivedTotal.inc();
  }

  /**
   * Counter `z_practice_skills_runs_total{status}` — каждое использование skill'а
   * в clone-respond (status: 'shadow'|'active').
   */
  incPracticeSkillsRun(args: { status: 'shadow' | 'active' }): void {
    this.practiceSkillsRunsTotal.inc({ status: args.status });
  }

  /**
   * Histogram `z_practice_skills_composite_score_vs_baseline` — delta
   * (composite - baseline). Значения клампятся в [-1, 1] на всякий случай.
   */
  observePracticeSkillsCompositeVsBaseline(args: { delta: number }): void {
    if (!Number.isFinite(args.delta)) return;
    const clamped = Math.min(Math.max(args.delta, -1), 1);
    this.practiceSkillsCompositeVsBaseline.observe(clamped);
  }

  /**
   * Counter `z_practice_skills_retrieval_hits_total{scope}` — retrieval вернул
   * ≥1 skill для конкретного scope (per-vызов, не per-skill).
   */
  incPracticeSkillsRetrievalHit(args: { scope: 'person' | 'role' | 'org' }): void {
    this.practiceSkillsRetrievalHitTotal.inc({ scope: args.scope });
  }

  // ── Agents v2 Фаза C2 (2026-05-30) — GEPA prompt evolution ──────────

  /**
   * Counter `z_gepa_optimizations_total{prompt_key, status}` — каждый запуск
   * GEPA-optimize (status='success' | 'failed' | 'timeout' | 'skipped_no_python').
   */
  incGepaOptimization(args: {
    promptKey: string;
    status: 'success' | 'failed' | 'timeout' | 'skipped_no_python';
  }): void {
    this.gepaOptimizationsTotal.inc({
      prompt_key: args.promptKey,
      status: args.status,
    });
  }

  /** Snapshot gauge — кол-во PromptCandidate по (prompt_key × status). */
  setGepaCandidatesTotal(args: {
    promptKey: string;
    status: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.gepaCandidatesTotal.set(
      { prompt_key: args.promptKey, status: args.status },
      args.value,
    );
  }

  /** Counter — кандидат прошёл A/B и промоутен. */
  incGepaPromoted(args: { promptKey: string }): void {
    this.gepaPromotedTotal.inc({ prompt_key: args.promptKey });
  }

  /** Counter — кандидат отклонён (reason из rejectedReason). */
  incGepaRejected(args: { reason: string }): void {
    this.gepaRejectedTotal.inc({ reason: args.reason });
  }

  /** Gauge — сколько кандидатов сейчас в status=testing (живой A/B). */
  setGepaAbActive(args: { value: number }): void {
    if (args.value < 0) return;
    this.gepaAbActiveTotal.set(args.value);
  }

  /** Counter — кумулятивная стоимость GEPA-runs в USD по tenant-bucket. */
  incGepaCost(args: { tenantTop: string; costUsd: number }): void {
    if (!Number.isFinite(args.costUsd) || args.costUsd < 0) return;
    this.gepaCostUsdTotal.inc({ tenant_top: args.tenantTop }, args.costUsd);
  }

  /** Counter — auto-rollback кандидата (reason='ab_deg'|'manual'|'stale'). */
  incGepaRollback(args: { reason: string }): void {
    this.gepaRollbackTotal.inc({ reason: args.reason });
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

  /**
   * KC-Temporal W3.2 (2026-05-25) — каждый раз, когда в LLM-контекст Chat-v2
   * подмешан reasoning chain top-N source-блоков.
   * `depth` — фактическая глубина BFS ('1' или '2' — string-label
   * Prometheus-стилем; budget-fallback с 2 на 1 учитывается).
   */
  incChatV2ReasoningChainsAttached(args: { depth: 1 | 2 }): void {
    this.chatV2ReasoningChainsAttachedTotal.inc({
      depth: String(args.depth),
    });
  }

  /**
   * KC-Temporal W3.3 (2026-05-25) — observe общее число contradicting блоков
   * в LLM-контексте одного ответа Chat-v2 (0..N).
   */
  observeChatV2ContradictingBlocksInContext(count: number): void {
    if (count < 0) return;
    this.chatV2ContradictingBlocksInContext.observe({}, count);
  }

  // ────────────────────── dialog-layer (SBA α-5) ───────────────────────

  /** SBA α-5 dialog-layer — AnswerCache HIT. tenant_top нормализован caller'ом. */
  incAnswerCacheHit(args: { tenantTop: string }): void {
    this.answerCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  /** SBA α-5 dialog-layer — RetrievalCache HIT. tenant_top нормализован caller'ом. */
  incRetrievalCacheHit(args: { tenantTop: string }): void {
    this.retrievalCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * SBA α-5 dialog-layer — длительность одного шага препроцессора.
   * step ∈ contextualize | confidence | classify | multi-query | summarize | total.
   */
  observeDialogProcessingDuration(args: {
    step:
      | 'contextualize'
      | 'confidence'
      | 'classify'
      | 'multi-query'
      | 'summarize'
      | 'total';
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.dialogProcessingDurationSeconds.observe(
      { step: args.step },
      args.seconds,
    );
  }

  /** SBA α-5 dialog-layer — успешная компрессия диалога в summary. */
  incConversationSummary(args: { tenantTop: string }): void {
    this.conversationSummaryTotal.inc({ tenant_top: args.tenantTop });
  }

  /** SBA α-5 dialog-layer — confidence ниже порога → fallback на raw userMessage. */
  incDialogConfidenceLow(args: { tenantTop: string }): void {
    this.dialogConfidenceLowTotal.inc({ tenant_top: args.tenantTop });
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

  /**
   * Фаза 1 clone-reliability-hardening — программный отказ клона отвечать
   * (анти-deepfake). Инкрементируется ДО вызова модели. `reason` —
   * например `topic_starved`.
   */
  incCloneAskRefused(args: { reason: string }): void {
    this.cloneAskRefusedTotal.inc({ reason: args.reason.slice(0, 64) });
  }

  // ────────────────────── SBA γ-1 доделки (SkillTraitCategory + versioning) ──

  /** SBA γ-1 доделки — установить gauge числа активных SkillTraitCategory per tenant_top. */
  setSkillCategoriesTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.skillCategoriesTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  /** SBA γ-1 доделки — установить gauge доли SkillTrait с заполненным categoryId per tenant_top. */
  setSkillTraitCategorizedRatio(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.skillTraitCategorizedRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /**
   * SBA γ-1 доделки — counter созданных ExecutablePersona snapshot.
   * `trigger ∈ {scheduled|threshold|critical|manual|on_demand}`.
   */
  incExecutablePersonaSnapshot(args: {
    tenantTop: string;
    trigger: 'scheduled' | 'threshold' | 'critical' | 'manual' | 'on_demand';
  }): void {
    this.executablePersonaSnapshotsTotal.inc({
      tenant_top: args.tenantTop,
      trigger: args.trigger,
    });
  }

  /**
   * SBA γ-1 доделки — gauge лага (секунды) от триггерного события до snapshot.
   * Хранит последнее значение per tenant_top.
   */
  setExecutablePersonaSnapshotLag(args: {
    tenantTop: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.executablePersonaSnapshotLagSeconds.set(
      { tenant_top: args.tenantTop },
      args.seconds,
    );
  }

  /**
   * Фаза 5 clone-reliability-hardening — counter триггеров rebuild
   * ExecutablePersona в watcher-cron'е. `reason` ∈ `trait_delta` | `max_age`.
   */
  incPersonaRebuildTriggered(args: {
    reason: 'trait_delta' | 'max_age';
  }): void {
    this.personaRebuildTriggeredTotal.inc({ reason: args.reason });
  }

  // ────────────────────── clone-reliability-hardening Фаза 2 (Смысловые блоки) ──

  /**
   * Фаза 2 — gauge числа SkillTraitConcept по статусу. Обновляется
   * cron-нормализатором раз в сутки.
   */
  setSkillTraitConceptsTotal(args: {
    status: 'active' | 'merged_into' | 'archived';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.skillTraitConceptsTotal.set({ status: args.status }, args.value);
  }

  /**
   * Фаза 2 — counter операций слияния SkillTraitConcept в cron-нормализаторе.
   * Инкрементируется один раз на каждый кластер из 2+ концептов, слитый
   * в опорный.
   */
  incSkillTraitConceptsMerged(): void {
    this.skillTraitConceptsMergedTotal.inc();
  }

  /**
   * TZ clone-method Э1.2 — counter исходов синтеза RolePrinciple:
   * created — новый принцип; merged — дедуп в существующий active;
   * rejected_guard — отброшен код-гардом диагностической лексики.
   */
  incRolePrincipleSynthesized(args: {
    outcome: 'created' | 'merged' | 'rejected_guard';
  }): void {
    this.rolePrinciplesSynthesizedTotal.inc({ outcome: args.outcome });
  }

  /**
   * TZ clone-method Э1.2 — gauge числа active RolePrinciple по всем Org.
   * Обновляется RolePrincipleSynthesisCron после каждого прохода.
   */
  setRolePrinciplesActiveTotal(value: number): void {
    if (value < 0) return;
    this.rolePrinciplesActiveTotal.set(value);
  }

  /**
   * TZ clone-method ВАЛ.1 — observe score (0..1) LLM-судьи поведенческой
   * верности ответа клона (variant: v1 — baseline «только черты» |
   * v2 — persona всех слоёв метода). Только наблюдение, ничего не блокирует.
   */
  observePersonaLayerScore(args: {
    variant: 'v1' | 'v2';
    score: number;
  }): void {
    if (!Number.isFinite(args.score) || args.score < 0 || args.score > 1) {
      return;
    }
    this.clonePersonaLayerScore.observe({ variant: args.variant }, args.score);
  }

  /**
   * TZ clone-method ВАЛ.1 — counter кейсов еженедельной поведенческой
   * валидации persona: judged — кейс оценён судьёй; skipped — кейс упал
   * (ошибка LLM / битый JSON судьи).
   */
  incPersonaLayerValidationCase(args: {
    outcome: 'judged' | 'skipped';
  }): void {
    this.personaLayerValidationCasesTotal.inc({ outcome: args.outcome });
  }

  /**
   * Clones=Roles Ф2 — инкремент counter'а «создана новая версия клона роли».
   * Дёргается из `RoleClonePersonaVersioningHandler` и admin force-new-version API.
   */
  incCloneRoleVersionCreated(args: { roleId: string }): void {
    this.cloneRoleVersionCreatedTotal.inc({ role_id: args.roleId });
  }

  /**
   * Clones=Roles Ф2 — gauge «общее число версий клона на роль» (включая
   * archived/superseded/pending_rebuild). Caller передаёт итоговое число
   * после count'а — мы пишем как есть. Negative — skip (защита от багов).
   */
  setCloneRoleVersionsTotal(args: { roleId: string; value: number }): void {
    if (args.value < 0) return;
    this.cloneRoleVersionsTotal.set({ role_id: args.roleId }, args.value);
  }

  // ────────────────────── SBA α-9 wave 3 (Company Foundation) ──────────

  /**
   * Установить gauge maturity_score_avg{tenant_top,scope}.
   * `tenantTop` — нормализуется на стороне caller'а (top-100 + 'other').
   */
  setMaturityScoreAvg(args: {
    tenantTop: string;
    scope: 'role' | 'department' | 'company';
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.maturityScoreAvg.set(
      { tenant_top: args.tenantTop, scope: args.scope },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /** Установить gauge domains_total{tenant_top}. */
  setDomainsTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.domainsTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  /** Установить gauge departments_total{tenant_top}. */
  setDepartmentsTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.departmentsTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  /** Установить gauge company_profile_completeness{tenant_top}. */
  setCompanyProfileCompleteness(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.companyProfileCompleteness.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /** Counter — сколько новых FunctionalDomain создал domain-expander. */
  incDomainExpanderCreated(args: { tenantTop: string; count: number }): void {
    if (args.count <= 0) return;
    this.domainExpanderCreatedTotal.inc({ tenant_top: args.tenantTop }, args.count);
  }

  /**
   * Старт таймера для гистограммы maturity_scorer_duration_seconds{scope}.
   * Возвращает завершающую функцию (вызвать в конце операции).
   */
  startMaturityScorerTimer(args: { scope: string }): () => void {
    return this.maturityScorerDurationSeconds.startTimer({ scope: args.scope });
  }

  // ────────────────────── SBA α-8 wave 3 (Appointment + KPI) ───────────

  /**
   * Установить gauge `appointments_total{tenant_top, status}`. tenant_top
   * нормализуется на caller'е (top-100 + 'other').
   */
  setAppointmentsTotal(args: {
    tenantTop: string;
    status: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.appointmentsTotal.set(
      { tenant_top: args.tenantTop, status: args.status },
      args.value,
    );
  }

  /** Counter — успешный PATCH /kpi/:id/measurement. */
  incKpiMeasurement(args: { tenantTop: string }): void {
    this.kpiMeasurementsTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Gauge — число KPI с просроченным lastMeasuredAt (по frequency-окну).
   * Расширяется cron-job'ом (если включён) или ad-hoc.
   */
  setKpiOverdueMeasurementsTotal(args: {
    tenantTop: string;
    frequency: string;
    value: number;
  }): void {
    if (args.value < 0) return;
    this.kpiOverdueMeasurementsTotal.set(
      { tenant_top: args.tenantTop, frequency: args.frequency },
      args.value,
    );
  }

  /**
   * Gauge — доля PersonRole, мигрированных в Appointment (0..1). Выставляется
   * patch-script'ом и admin-эндпоинтом «прогресс миграции».
   */
  setPersonRoleToAppointmentMigrationProgress(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.personRoleToAppointmentMigrationProgress.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  // ────────────────────── SBA β-7 (Brand Voice Curator) ───────────────

  /**
   * Gauge `brand_voice_profile_completeness{tenant_top}`. Значение клампится
   * в [0,1]. Tenant_top — top-100 bucket из `brandVoiceTenantTop(tenantId)`,
   * чтобы не взорвать cardinality на масштабе тысячи Org.
   */
  setBrandVoiceProfileCompleteness(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.brandVoiceProfileCompleteness.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /**
   * Counter `brand_voice_extractor_runs_total{tenant_top, result}`. Один
   * вызов — один запуск daily-cron на один тенант. result ∈
   * `built | skipped_disabled | skipped_low_corpus | llm_error | db_error`.
   */
  incBrandVoiceExtractorRun(args: {
    tenantTop: string;
    result: string;
  }): void {
    this.brandVoiceExtractorRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /**
   * Gauge `brand_voice_corpus_size{tenant_top}`. Сколько Document'ов с
   * useCases includes 'brand_corpus' лежит в тенанте на момент cron-прохода.
   */
  setBrandVoiceCorpusSize(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.brandVoiceCorpusSize.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  // ────────────────────── SBA α-3 wave 3 (AxisClassifier + LLM fallback) ─

  /**
   * Counter — одна axis-метка проставлена (insert новой записи в
   * IdeaBlockAxisLabel; уже-существующие upsert'ы НЕ инкрементируют).
   * axis ∈ who|functional|contextual|temporal; source ∈ static|llm|manual.
   */
  incAxisLabel(args: {
    tenantTop: string;
    axis: string;
    source: string;
  }): void {
    this.axisLabelsTotal.inc({
      tenant_top: args.tenantTop,
      axis: args.axis,
      source: args.source,
    });
  }

  /**
   * Counter — вызов LLM-fallback роутера. result ∈ matched|no_match|llm_error.
   */
  incRouterFallbackCall(args: {
    tenantTop: string;
    result: 'matched' | 'no_match' | 'llm_error';
  }): void {
    this.routerFallbackCallsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /** Counter — попадание в Redis-кэш LLM-fallback (cache hit). */
  incRouterFallbackCacheHit(args: { tenantTop: string }): void {
    this.routerFallbackCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Histogram — длительность одного LLM-вызова axis-classify per axis.
   * Caller вызывает ОДИН раз per LLM-call (т.е. для одного txn — оба axis).
   */
  observeAxisClassifyDuration(args: { axis: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.axisClassifyDurationSeconds.observe({ axis: args.axis }, args.seconds);
  }

  // ────────────────────── SBA α-8 wave 4 (Role Map) ──────────────────

  /** Установить gauge `role_map_completeness_avg{tenant_top}`. */
  setRoleMapCompletenessAvg(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.roleMapCompletenessAvg.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /** Counter — один flush батча RoleMapBuilderWorker. */
  incRoleMapBuilderRun(args: { tenantTop: string; result: string }): void {
    this.roleMapBuilderRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  /**
   * Старт таймера для гистограммы `role_map_extract_duration_seconds`.
   * Возвращает завершающую функцию (вызвать в конце операции).
   */
  startRoleMapExtractTimer(): () => void {
    return this.roleMapExtractDurationSeconds.startTimer();
  }

  /** Gauge `roles_with_normalized_data_ratio{tenant_top}`. */
  setRolesWithNormalizedDataRatio(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (Number.isNaN(args.value)) return;
    this.rolesWithNormalizedDataRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  // ────────────────────── SBA β-8 (DailyCheckIn + Operations + PersonalRelation) ────────

  /** Counter `daily_checkins_completed_total{tenant_top, kind}`. */
  incDailyCheckinCompleted(args: {
    tenantTop: string;
    kind: 'morning' | 'evening';
  }): void {
    this.dailyCheckinsCompletedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  /**
   * Counter `daily_checkins_skipped_total{tenant_top, kind, reason}`.
   * reason ∈ already_completed|outside_window|disabled|no_channel|no_person|low_confidence.
   */
  incDailyCheckinSkipped(args: {
    tenantTop: string;
    kind: 'morning' | 'evening';
    reason: string;
  }): void {
    this.dailyCheckinsSkippedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
      reason: args.reason,
    });
  }

  /** Gauge `operations_blockers_total{tenant_top, severity}`. */
  setOperationsBlockersTotal(args: {
    tenantTop: string;
    severity: 'low' | 'medium' | 'high' | 'unknown';
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.operationsBlockersTotal.set(
      { tenant_top: args.tenantTop, severity: args.severity },
      Math.max(0, Math.floor(args.value)),
    );
  }

  /** Gauge `team_frictions_total{tenant_top}`. */
  setTeamFrictionsTotal(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.teamFrictionsTotal.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  /** Counter `goal_cascade_misses_total{tenant_top}`. */
  incGoalCascadeMisses(args: { tenantTop: string; count?: number }): void {
    const inc = args.count ?? 1;
    if (inc <= 0) return;
    this.goalCascadeMissesTotal.inc({ tenant_top: args.tenantTop }, inc);
  }

  /** Counter `personal_relation_builder_runs_total{tenant_top, result, source}`. */
  incPersonalRelationBuilderRun(args: {
    tenantTop: string;
    result: string;
    source: 'graph' | 'regex';
  }): void {
    this.personalRelationBuilderRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
      source: args.source,
    });
  }

  // ────────────────────── ТЗ-2 Ф1 (главная директора) ──────────────────

  /**
   * Counter `dashboard_value_strip_served_total{tenant_top}`.
   * `tenantTop` нормализуется caller'ом через `tenantTopOf` (top-100 bucket).
   */
  incDashboardValueStripServed(args: { tenantTop: string }): void {
    this.dashboardValueStripServedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Gauge `dashboard_main_first_screen_widget_count{tenant_top}`.
   * `tenantTop` нормализуется caller'ом через `tenantTopOf`.
   */
  setDashboardMainFirstScreenWidgetCount(args: {
    tenantTop: string;
    count: number;
  }): void {
    if (!Number.isFinite(args.count)) return;
    this.dashboardMainFirstScreenWidgetCount.set(
      { tenant_top: args.tenantTop },
      args.count,
    );
  }

  /**
   * ТЗ-2 Ф4 — фиксируем расчёт недельного план-факта:
   *  - `weekly_per_person_no_answer_total{tenant_top}` += суммарные «без ответа»
   *    (commitmentStatus='asked') за этот compute (если > 0).
   * `tenantTop` нормализуется caller'ом через `tenantTopOf` (top-100 bucket).
   */
  recordWeeklyPerPersonCompute(args: {
    tenantTop: string;
    noAnswerTotal: number;
  }): void {
    if (Number.isFinite(args.noAnswerTotal) && args.noAnswerTotal > 0) {
      this.weeklyPerPersonNoAnswerTotal.inc(
        { tenant_top: args.tenantTop },
        args.noAnswerTotal,
      );
    }
  }

  /**
   * Counter `weekly_per_person_self_view_served_total{tenant_top}` (ТЗ-2 Ф4 —
   * каждая успешная отдача self-view /me/weekly-per-person).
   * `tenantTop` нормализуется caller'ом через `tenantTopOf`.
   */
  incWeeklyPerPersonSelfViewServed(args: { tenantTop: string }): void {
    this.weeklyPerPersonSelfViewServedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Counter `me_ideas_fate_served_total{tenant_top}` (ТЗ-2 Ф5 — каждая успешная
   * отдача self-эндпоинта «судьба моих идей» /me/ideas).
   * `tenantTop` нормализуется caller'ом через `tenantTopOf`.
   */
  incMyIdeasFateServed(args: { tenantTop: string }): void {
    this.myIdeasFateServedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Counter `me_recognitions_served_total{tenant_top}` (ТЗ-2 Ф5 — каждая
   * успешная отдача self-эндпоинта «полученные признания» /me/recognitions).
   * `tenantTop` нормализуется caller'ом через `tenantTopOf`.
   */
  incMyRecognitionsServed(args: { tenantTop: string }): void {
    this.myRecognitionsServedTotal.inc({ tenant_top: args.tenantTop });
  }

  // ────────────────────── SBA β-8.1 (COO добивка) ──────────────────────

  /** Counter `coo_sentiment_analyzed_total{tenant_top, sentiment}`. */
  incCooSentimentAnalyzed(args: {
    tenantTop: string;
    sentiment: 'green' | 'yellow' | 'red';
  }): void {
    this.cooSentimentAnalyzedTotal.inc({
      tenant_top: args.tenantTop,
      sentiment: args.sentiment,
    });
  }

  /**
   * Counter `coo_sentiment_failed_total{tenant_top, reason}`.
   *
   * `reason` — необязательный для обратной совместимости с существующими
   * вызовами; default `'other'`. Batch-парсер silent-skip'ает кривые
   * элементы → cron должен звать с `reason: 'invalid_element'`.
   */
  incCooSentimentFailed(args: {
    tenantTop: string;
    reason?: 'invalid_element' | 'other';
  }): void {
    this.cooSentimentFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason ?? 'other',
    });
  }

  /**
   * Counter `z_checkin_graph_ingest_total{result}` — мост чек-ин → граф знаний
   * (ТЗ 2026-06-10-daily-checkin-to-graph-bridge). result ∈ ok | skipped | error
   * (best-effort, ошибка моста не ломает создание чек-ина).
   */
  incCheckinGraphIngest(args: { result: 'ok' | 'skipped' | 'error' }): void {
    this.checkinGraphIngestTotal.inc({ result: args.result });
  }

  /** Counter `coo_weekly_digest_generated_total{tenant_top}`. */
  incCooWeeklyDigestGenerated(args: { tenantTop: string }): void {
    this.cooWeeklyDigestGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `coo_weekly_digest_failed_total{tenant_top, reason}`. */
  incCooWeeklyDigestFailed(args: {
    tenantTop: string;
    reason: string;
  }): void {
    this.cooWeeklyDigestFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  /** Gauge `coo_team_temperature_red_share{tenant_top}` (0..1). */
  setCooTeamTemperatureRedShare(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooTeamTemperatureRedShare.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  /**
   * ТЗ-2 Ф2 — Gauge `coo_blockers_resolved_total{tenant_top}`.
   * Сколько блокеров закрыто (status=resolved) за последние 30 дней.
   */
  setCooBlockersResolved(args: { tenantTop: string; count: number }): void {
    if (!Number.isFinite(args.count)) return;
    this.cooBlockersResolvedTotal.set(
      { tenant_top: args.tenantTop },
      Math.max(0, args.count),
    );
  }

  /**
   * ТЗ-2 Ф2 — Counter `coo_team_capacity_widget_served_total{tenant_top}`.
   * Инкремент на каждую отдачу виджета загрузки команд COO.
   */
  incCooTeamCapacityWidgetServed(args: { tenantTop: string }): void {
    this.cooTeamCapacityWidgetServedTotal.inc({ tenant_top: args.tenantTop });
  }

  // ────────────────────── SBA β-8.3 — Daily Digest ────────────────────

  /** Counter `coo_daily_digest_generated_total{tenant_top}`. */
  incCooDailyDigestGenerated(args: { tenantTop: string }): void {
    this.cooDailyDigestGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `coo_daily_digest_failed_total{tenant_top, reason}`. */
  incCooDailyDigestFailed(args: {
    tenantTop: string;
    reason: string;
  }): void {
    this.cooDailyDigestFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  /** Counter `coo_daily_digest_delivered_total{tenant_top, channel}`. */
  incCooDailyDigestDelivered(args: {
    tenantTop: string;
    channel: string;
  }): void {
    this.cooDailyDigestDeliveredTotal.inc({
      tenant_top: args.tenantTop,
      channel: args.channel,
    });
  }

  /** Gauge `coo_daily_digest_age_seconds{tenant_top}` (now − createdAt). */
  setCooDailyDigestAge(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooDailyDigestAgeSeconds.set(
      { tenant_top: args.tenantTop },
      Math.max(0, args.value),
    );
  }

  // ────────────────────── «Месяц компании» — Monthly Digest ───────────

  /** Counter `coo_monthly_digest_generated_total{tenant_top}`. */
  incCooMonthlyDigestGenerated(args: { tenantTop: string }): void {
    this.cooMonthlyDigestGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `coo_monthly_digest_failed_total{tenant_top, reason}`. */
  incCooMonthlyDigestFailed(args: {
    tenantTop: string;
    reason: string;
  }): void {
    this.cooMonthlyDigestFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  /** Counter `coo_monthly_digest_delivered_total{tenant_top, channel}`. */
  incCooMonthlyDigestDelivered(args: {
    tenantTop: string;
    channel: string;
  }): void {
    this.cooMonthlyDigestDeliveredTotal.inc({
      tenant_top: args.tenantTop,
      channel: args.channel,
    });
  }

  // ────────────────────── TZ-1 Ф3.D — фиксы достоверности ──────────────

  /**
   * Gauge `commitment_author_coverage_ratio{tenant_top}` (0..1). Доля
   * commitment с непустым commitmentAuthorPersonId в прогоне goal-vector.
   */
  setCommitmentAuthorCoverageRatio(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.commitmentAuthorCoverageRatio.set(
      { tenant_top: args.tenantTop },
      Math.min(1, Math.max(0, args.value)),
    );
  }

  /** Counter `probe_suggested_total{trigger}`. */
  incProbeSuggested(args: { trigger: string }): void {
    this.probeSuggestedTotal.inc({ trigger: args.trigger });
  }

  // ────────────────────── SBA β-8.3 Wave 2 — COO overview ────────────

  /**
   * Gauge `coo_insights_by_cause_total{tenant_top, cause}`. Cause —
   * whitelist из 8 значений `Insight.causeCategory`; для записей с
   * `causeCategory=NULL` используется bucket `'unknown'`.
   */
  setCooInsightsByCause(args: {
    tenantTop: string;
    cause: string;
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooInsightsByCauseTotal.set(
      { tenant_top: args.tenantTop, cause: args.cause },
      Math.max(0, Math.floor(args.value)),
    );
  }

  /**
   * Gauge `coo_company_maturity_score{tenant_top}` (0..1). НЕ публикуем,
   * если score=null (cron `MaturityScorerCron` ещё не отработал) — это
   * штатное состояние раннего tenant'а, мы не хотим зашумлять метрику нулём.
   */
  setCooCompanyMaturityScore(args: {
    tenantTop: string;
    value: number;
  }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooCompanyMaturityScore.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  // ────────────────────── SBA β-8.2 — Promise Keeper ──────────────────

  /** Gauge `commitments_open_total{tenant_top}`. */
  setCommitmentsOpenTotal(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.commitmentsOpenTotal.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  /** Counter `commitments_asked_total{tenant_top}`. */
  incCommitmentsAsked(args: { tenantTop: string }): void {
    this.commitmentsAskedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `commitments_fulfilled_total{tenant_top}`. */
  incCommitmentsFulfilled(args: { tenantTop: string }): void {
    this.commitmentsFulfilledTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `commitments_missed_total{tenant_top}`. */
  incCommitmentsMissed(args: { tenantTop: string }): void {
    this.commitmentsMissedTotal.inc({ tenant_top: args.tenantTop });
  }

  /** Counter `commitments_escalated_total{tenant_top}`. */
  incCommitmentsEscalated(args: { tenantTop: string }): void {
    this.commitmentsEscalatedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Counter `commitments_extract_failed_total{tenant_top, reason}`.
   * reason ∈ llm_failed|parse_failed|no_block|exception.
   */
  incCommitmentsExtractFailed(args: { tenantTop: string; reason: string }): void {
    this.commitmentsExtractFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  // ────────────────────── SBA δ-3 — VoiceChannelAdapter ───────────────

  /**
   * Один REST-вызов `/api/v1/voice/transcribe`. provider — ASR-провайдер
   * (vox / gigaam / openai / ...). tenantTop — top-100 bucket.
   */
  incVoiceAsrRequest(args: { tenantTop: string; provider: string }): void {
    this.voiceAsrRequestsTotal.inc({
      tenant_top: args.tenantTop,
      provider: args.provider,
    });
  }

  /**
   * Длительность ASR-вызова в секундах (Vox submit+poll или эквивалент).
   * Cardinality-safe: только provider в label.
   */
  observeVoiceAsrDuration(args: { provider: string; seconds: number }): void {
    if (!Number.isFinite(args.seconds) || args.seconds < 0) return;
    this.voiceAsrDurationSeconds.observe(
      { provider: args.provider },
      args.seconds,
    );
  }

  /**
   * Один REST-вызов `/api/v1/voice/synthesize`. provider — TTS-провайдер.
   */
  incVoiceTtsRequest(args: { tenantTop: string; provider: string }): void {
    this.voiceTtsRequestsTotal.inc({
      tenant_top: args.tenantTop,
      provider: args.provider,
    });
  }

  /**
   * Сколько символов отправлено в TTS — для оценки стоимости (OpenAI TTS
   * биллит за 1M chars). tenantTop — top-100 bucket.
   */
  addVoiceTtsChars(args: { tenantTop: string; chars: number }): void {
    if (!Number.isFinite(args.chars) || args.chars <= 0) return;
    this.voiceTtsCharsTotal.inc(
      { tenant_top: args.tenantTop },
      Math.floor(args.chars),
    );
  }

  // ────────────────────── T4 / δ-3 — VoiceStreamGateway ───────────────

  /**
   * Один завершённый WS-сценарий voice-стриминга (Concierge микрофон).
   * outcome:
   *   - `completed` — пришёл voice:end + ASR вернул текст;
   *   - `cancelled` — клиент послал voice:cancel или disconnect до end;
   *   - `error` — ошибка (auth, buffer_overflow, ASR upstream и т.п.);
   *   - `timeout` — TTL guard убил незавершённую сессию (> 60 сек).
   */
  incVoiceWsSession(outcome: 'completed' | 'cancelled' | 'error' | 'timeout'): void {
    this.voiceWsSessionTotal.inc({ outcome });
  }

  /** Один принятый audio-chunk (timeslice 200ms). */
  incVoiceWsChunk(): void {
    this.voiceWsChunkTotal.inc();
  }

  /**
   * Задержка от `voice:end` до `voice:transcribed` (включая ASR submit+poll).
   * Cardinality-safe: без labels. Vox даёт ≥ 2 сек из-за poll-модели —
   * histogram это покажет; миграция на streaming ASR (Whisper realtime)
   * должна снизить p50 до 200-500 ms.
   */
  observeVoiceWsAsrLatency(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.voiceWsAsrLatencyMs.observe(ms);
  }

  // ────────────────────── SBA γ-2 (Concierge Agent) ────────────────────

  /** Counter `concierge_messages_total{tenant_top}`. */
  incConciergeMessage(args: { tenantTop: string }): void {
    this.conciergeMessagesTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Counter `concierge_tool_calls_total{tenant_top, tool, status}`. status ∈
   * `ok|error|forbidden`. tool — имя whitelist tool ServiceMap'а (ограниченный
   * фиксированный набор).
   */
  incConciergeToolCall(args: {
    tenantTop: string;
    tool: string;
    status: 'ok' | 'error' | 'forbidden';
  }): void {
    this.conciergeToolCallsTotal.inc({
      tenant_top: args.tenantTop,
      tool: args.tool,
      status: args.status,
    });
  }

  /** Counter `concierge_undo_total{tenant_top, tool}` — успешные откаты. */
  incConciergeUndo(args: { tenantTop: string; tool: string }): void {
    this.conciergeUndoTotal.inc({
      tenant_top: args.tenantTop,
      tool: args.tool,
    });
  }

  /** Counter `concierge_quota_exceeded_total{tenant_top, scope}`. */
  incConciergeQuotaExceeded(args: {
    tenantTop: string;
    scope: 'daily' | 'monthly';
  }): void {
    this.conciergeQuotaExceededTotal.inc({
      tenant_top: args.tenantTop,
      scope: args.scope,
    });
  }

  // ────────────────────── ТЗ 2026-05-27 Фаза 4 (dialog-layer obs) ──────

  /**
   * Counter `concierge_dialog_layer_used_total{intent}` — сколько раз
   * dialog-layer препроцессор применился к запросу Concierge. Лейбл
   * `intent` обрезается по 32 символа для защиты от мусора (фиксированный
   * whitelist всё равно короче, но lower-bound защищает от регрессий
   * классификатора).
   */
  incConciergeDialogLayerUsed(args: { intent: string }): void {
    this.conciergeDialogLayerUsedTotal.inc({ intent: args.intent.slice(0, 32) });
  }

  /**
   * Counter `concierge_cache_hit_total` — AnswerCache short-circuit
   * (без LLM-вызова). Без labels: tenant-агрегацию делает Grafana
   * поверх БД, intent уже учтён через `concierge_dialog_layer_used_total`.
   */
  incConciergeCacheHit(): void {
    this.conciergeCacheHitTotal.inc();
  }

  /**
   * Histogram `concierge_pre_retrieval_hits_count` — суммарное число hits
   * pre-retrieval `search_knowledge` по всем queries dialog-layer.
   * Используется для калибровки `CONCIERGE_PRE_RETRIEVAL_TOP_K`.
   */
  observeConciergePreRetrievalHits(count: number): void {
    if (!Number.isFinite(count) || count < 0) return;
    this.conciergePreRetrievalHitsCount.observe(count);
  }

  // ────────────────────── SBA δ-1 (Orchestrator) ─────────────────────

  /** Counter `orchestrator_runs_total{status}`. status ∈ done|failed|timeout|cancelled. */
  incOrchestratorRun(args: {
    status: 'done' | 'failed' | 'timeout' | 'cancelled';
  }): void {
    this.orchestratorRunsTotal.inc({ status: args.status });
  }

  /** Counter `orchestrator_subagents_total{agent_type, result}`. */
  incOrchestratorSubagent(args: {
    agentType: string;
    result: 'done' | 'failed' | 'low_confidence';
  }): void {
    this.orchestratorSubagentsTotal.inc({
      agent_type: args.agentType,
      result: args.result,
    });
  }

  /** Histogram `orchestrator_run_duration_seconds`. */
  observeOrchestratorRunDurationSeconds(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.orchestratorRunDurationSeconds.observe(seconds);
  }

  /** Counter `orchestrator_verification_low_confidence_total`. */
  incOrchestratorVerificationLowConfidence(): void {
    this.orchestratorVerificationLowConfidenceTotal.inc();
  }

  // ────────────────────── SBA α-10 wave 3 — Admin LLM + Economics ─────

  addAiCostUsdLabeled(args: {
    tenantTop: string;
    taskType: string;
    provider: string;
    model: string;
    amount: number;
  }): void {
    if (!Number.isFinite(args.amount) || args.amount <= 0) return;
    this.aiCostUsdLabeledTotal.inc(
      {
        tenant_top: args.tenantTop,
        task_type: args.taskType,
        provider: args.provider,
        model: args.model,
      },
      args.amount,
    );
  }

  addAiCostRub(args: {
    tenantTop: string;
    taskType: string;
    provider: string;
    model: string;
    amount: number;
  }): void {
    if (!Number.isFinite(args.amount) || args.amount <= 0) return;
    this.aiCostRubLabeledTotal.inc(
      {
        tenant_top: args.tenantTop,
        task_type: args.taskType,
        provider: args.provider,
        model: args.model,
      },
      args.amount,
    );
  }

  incAiCallsLabeled(args: {
    tenantTop: string;
    taskType: string;
    provider: string;
    model: string;
    success: boolean;
    count?: number;
  }): void {
    const inc = args.count ?? 1;
    if (inc <= 0) return;
    this.aiCallsLabeledTotal.inc(
      {
        tenant_top: args.tenantTop,
        task_type: args.taskType,
        provider: args.provider,
        model: args.model,
        success: args.success ? 'true' : 'false',
      },
      inc,
    );
  }

  setOrgBudgetUtilizationPercent(args: {
    tenantTop: string;
    percent: number;
  }): void {
    if (!Number.isFinite(args.percent) || args.percent < 0) return;
    this.orgBudgetUtilizationPercent.set(
      { tenant_top: args.tenantTop },
      args.percent,
    );
  }

  setProviderSmokeTestSuccess(args: {
    provider: string;
    success: boolean;
  }): void {
    this.providerSmokeTestSuccess.set(
      { provider: args.provider },
      args.success ? 1 : 0,
    );
  }

  observeProviderSmokeTestDuration(args: {
    provider: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.providerSmokeTestDurationSeconds.observe(
      { provider: args.provider },
      args.seconds,
    );
  }

  setCurrencyRateUsdRub(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.currencyRateUsdRub.set(rate);
  }

  incCurrencyRateSync(result: 'success' | 'fallback' | 'failed'): void {
    this.currencyRateSyncTotal.inc({ result });
  }

  incDailyCostAggregatorRun(result: 'success' | 'failed'): void {
    this.dailyCostAggregatorRunsTotal.inc({ result });
  }

  incOrgEconomicsRun(result: 'success' | 'failed'): void {
    this.orgEconomicsRunsTotal.inc({ result });
  }

  incBudgetAlertSent(threshold: number): void {
    this.budgetAlertSentTotal.inc({ threshold: String(threshold) });
  }

  // ────────────────────── SBA δ-2 — ProactiveWatcher ────────────────

  /** Создан и отправлен ProactiveNotification (rule × severity). */
  incProactiveEmitted(args: {
    rule: string;
    severity: 'low' | 'medium' | 'high';
  }): void {
    this.proactiveNotificationsEmittedTotal.inc({
      rule: args.rule,
      severity: args.severity,
    });
  }

  /** Пользователь нажал «Скрыть» на ProactiveNotification. */
  incProactiveDismissed(args: { rule: string }): void {
    this.proactiveNotificationsDismissedTotal.inc({ rule: args.rule });
  }

  /** Anti-spam dedup отбросил ProactiveNotification (Redis SETNX hit). */
  incProactiveDedupSkipped(): void {
    this.proactiveNotificationsDedupSkippedTotal.inc();
  }

  /** Длительность обработки одного правила ProactiveWatcher (секунды). */
  observeProactiveRuleDuration(args: {
    rule: string;
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.proactiveWatcherDurationSeconds.observe(
      { rule: args.rule },
      args.seconds,
    );
  }

  // ─── tracker (Sprint 1 B1-1.3 / B1-1.4 / Sprint 3 B1-3.1) ────────────

  /** Tracker — задача создана. source ∈ manual|api|meeting|telegram|email|mobile_voice. */
  incIssueCreated(args: { tenant: string; project: string; source: string }): void {
    this.issuesCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
      source: args.source,
    });
  }

  /** Tracker — задача переведена в done (штатно закрытая). */
  incIssueCompleted(args: { tenant: string; project: string }): void {
    this.issuesCompletedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker (2026-05-27) — создана подзадача (Issue с parentId !== null).
   * Вызов из IssuesService.create() сразу после успешной транзакции.
   */
  incSubtaskCreated(args: { tenant: string; project: string }): void {
    this.subtasksCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker Checklists (2026-05-27) — создание чек-листа на задаче.
   * Caller: `ChecklistsService.createChecklist`.
   */
  incChecklistCreated(args: { tenant: string; project: string }): void {
    this.checklistsCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker Checklists — пункт добавлен (в т.ч. через bulk-create).
   * `viaBulk=true` → пункт пришёл из POST `/checklist-items/bulk-create`.
   */
  incChecklistItemAdded(args: {
    tenant: string;
    project: string;
    viaBulk: boolean;
  }): void {
    this.checklistItemsAddedTotal.inc({
      tenant: args.tenant,
      project: args.project,
      via_bulk: args.viaBulk ? 'true' : 'false',
    });
  }

  /**
   * Tracker Checklists — пункт переведён в isDone=true (положительный
   * переход; обратные переходы (done→undone) этот счётчик NE считает).
   */
  incChecklistItemCompleted(args: { tenant: string; project: string }): void {
    this.checklistItemsCompletedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker Project Documents (2026-05-27) — создание документа проекта.
   * Caller: `ProjectDocumentsService.create`.
   */
  incProjectDocumentCreated(args: {
    tenant: string;
    project: string;
  }): void {
    this.projectDocumentsCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker Project Documents — обновление документа (включая auto-save).
   * Caller: `ProjectDocumentsService.update`.
   */
  incProjectDocumentUpdated(args: {
    tenant: string;
    project: string;
  }): void {
    this.projectDocumentsUpdatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /**
   * Tracker Project Documents — запрошен блок «Связанные карточки».
   * Caller: `ProjectDocumentsService.listLinkedCards`.
   */
  incLinkedCardsView(args: { tenant: string; project: string }): void {
    this.linkedCardsViewTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  /** Tracker Intake — обработанная карточка. decision ∈ accepted|rejected|snoozed|duplicate. */
  incIntakeTriaged(args: { tenant: string; decision: string }): void {
    this.intakeTriagedTotal.inc({
      tenant: args.tenant,
      decision: args.decision,
    });
  }

  /** Tracker Webhooks Out — доставка исходящего webhook'а. */
  incTrackerWebhookDelivery(args: {
    tenant: string;
    event: string;
    success: boolean;
  }): void {
    this.trackerWebhookDeliveryTotal.inc({
      tenant: args.tenant,
      event: args.event,
      success: String(args.success),
    });
  }

  incTrackerWebhookRetry(args: { tenant: string; webhookId: string }): void {
    this.trackerWebhookRetryCount.inc({
      tenant: args.tenant,
      webhook_id: args.webhookId,
    });
  }

  /**
   * Sprint 3 B1-3.1 — Tracker → knowledge-core bridge: событие отправлено
   * в core.raw-events. `type` — оригинальный тип события трекера
   * (issue.created / status_changed_to_blocked / comment.created / …).
   */
  incTrackerEventToKnowledgeCore(args: { tenant: string; type: string }): void {
    this.trackerEventsToKnowledgeCoreTotal.inc({
      tenant: args.tenant,
      type: args.type,
    });
  }

  /**
   * Tracker Phase 3 — обработка embedding-job'а для Issue.
   *
   *  - `ok`      — embedding пересчитан и записан;
   *  - `skipped` — hash text совпал, пересчёт не нужен;
   *  - `failed`  — провайдер embedding'а упал.
   *
   * `tenantTop` нормализуется через `tenantTopOf` (top-100 bucket).
   */
  incTrackerIssueEmbed(args: {
    tenantTop: string;
    status: 'ok' | 'skipped' | 'failed';
  }): void {
    this.trackerIssueEmbedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  /**
   * Tracker Phase 3 — KNN-поиск похожих задач
   * (`GET /tracker/issues/:id/similar`). Считает все запросы (включая те,
   * где исходная задача без embedding'а — там результат пустой).
   */
  incTrackerIssueSimilarSearch(args: { tenantTop: string }): void {
    this.trackerIssueSimilarSearchTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Tracker Phase 3 part C — счётчик попыток inference полей задачи.
   * `accepted` — на момент inference всегда `false`. Если фронт принимает
   * подсказку через PATCH /issues/:id — вызывается ещё раз с `accepted='true'`.
   */
  incAiIssueInferred(args: {
    tenantTop: string;
    accepted: 'true' | 'false';
  }): void {
    this.aiIssueInferredTotal.inc({
      tenant_top: args.tenantTop,
      accepted: args.accepted,
    });
  }

  /**
   * Tracker Phase 3 part C — предложение goalId.
   * `source` ∈ knn (top-K KNN сходит в одну Goal) | llm (fallback) | none.
   */
  incAiIssueGoalSuggested(args: {
    tenantTop: string;
    accepted: 'true' | 'false';
    source: 'knn' | 'llm' | 'none';
  }): void {
    this.aiIssueGoalSuggestedTotal.inc({
      tenant_top: args.tenantTop,
      accepted: args.accepted,
      source: args.source,
    });
  }

  /**
   * Tracker Phase 3 part B — MeetingExtractActionsService завершил вызов.
   * Если count>0 — `incBy` для каждой созданной задачи отдельно (через цикл
   * у caller'а). Здесь — только агрегатный статус (created / empty / error /
   * skipped_idempotent).
   */
  incAiMeetingActionsExtracted(args: {
    tenantTop: string;
    status:
      | 'created'
      | 'skipped_idempotent'
      | 'llm_empty'
      | 'llm_error';
    by?: number;
  }): void {
    this.aiMeetingActionsExtractedTotal.inc(
      { tenant_top: args.tenantTop, status: args.status },
      args.by ?? 1,
    );
  }

  /**
   * Tracker Phase 3 part B + W4 autonomy (2026-06-12) — IntakeAutoTriage
   * авто-принял IntakeIssue. Разрезы: source — канал intake (meeting/telegram/
   * in_app/…); viaDefaultProject='true' — Issue создан в дефолт-проект
   * «Входящие» (атрибуция проекта не выводилась).
   */
  incAiIntakeAutoAccepted(args: {
    tenantTop: string;
    source: string;
    viaDefaultProject: 'true' | 'false';
  }): void {
    this.aiIntakeAutoAcceptedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
      via_default_project: args.viaDefaultProject,
    });
  }

  /**
   * Tracker Phase 3 part B + W4 autonomy (2026-06-12) — IntakeAutoTriage
   * заполнил suggested* (или ошибка). source — канал intake.
   */
  incAiIntakeSuggested(args: {
    tenantTop: string;
    status:
      | 'auto_accepted'
      | 'pending'
      | 'llm_error'
      | 'skipped_already_triaged';
    source: string;
  }): void {
    this.aiIntakeSuggestedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
      source: args.source,
    });
  }

  /** Tracker — snapshot количества задач в данном состоянии (set из cron'а). */
  setIssuesByStateCount(args: {
    tenant: string;
    project: string;
    state: string;
    count: number;
  }): void {
    this.issuesByStateCount.set(
      { tenant: args.tenant, project: args.project, state: args.state },
      args.count,
    );
  }

  /** Tracker — snapshot количества просроченных задач (set из cron'а). */
  setIssuesOverdueCount(args: {
    tenant: string;
    project: string;
    count: number;
  }): void {
    this.issuesOverdueCount.set(
      { tenant: args.tenant, project: args.project },
      args.count,
    );
  }

  /** Tracker Intake — snapshot количества pending intake-карточек. */
  setIntakePendingCount(args: { tenant: string; count: number }): void {
    this.intakePendingCount.set({ tenant: args.tenant }, args.count);
  }

  /**
   * Tracker Phase 4 part 2 — Project создан через POST /projects/from-template.
   * `slug` — слаг шаблона (`sales`|`development`|`installation`|...).
   */
  incTeamTemplateUsed(args: { tenantTop: string; slug: string }): void {
    this.teamTemplateUsedTotal.inc({
      tenant_top: args.tenantTop,
      slug: args.slug,
    });
  }

  /**
   * Tracker Phase 4 part 2 — HolidayService.adjustDueDate сдвинул dueDate
   * задачи на следующий рабочий день (попадание на праздник / выходной).
   */
  incHolidayDueDateAdjusted(args: { tenantTop: string }): void {
    this.holidayDueDateAdjustedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Tracker Boards (2026-05-27) — создание доски в проекте.
   * `tenantTop` — top-100 bucket (нормализация через `tenantTopOf`).
   * `project` — UUID; в проде следить за cardinality (~100 проектов на tenant).
   */
  incBoardCreated(args: { tenantTop: string; project: string }): void {
    this.boardsCreatedTotal.inc({
      tenant_top: args.tenantTop,
      project: args.project,
    });
  }

  /** Tracker Boards — архивация доски (POST /boards/:id/archive). */
  incBoardArchived(args: { tenantTop: string; project: string }): void {
    this.boardsArchivedTotal.inc({
      tenant_top: args.tenantTop,
      project: args.project,
    });
  }

  /**
   * Tracker Boards — задача перенесена между досками одного проекта
   * (PATCH /issues/:id { boardId }). `fromBoard` может быть пустой строкой,
   * если задача ранее не имела `boardId` (легаси до backfill).
   */
  incBoardIssueMoved(args: {
    tenantTop: string;
    fromBoard: string;
    toBoard: string;
  }): void {
    this.boardIssuesMovedTotal.inc({
      tenant_top: args.tenantTop,
      from_board: args.fromBoard,
      to_board: args.toBoard,
    });
  }

  /**
   * Tracker — задача перенесена в другой проект (POST /issues/:id/move).
   * ТЗ plans/tz/2026-06-15-issue-move-to-project.md.
   */
  incIssueMovedToProject(args: { tenantTop: string }): void {
    this.issueMovedToProjectTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Tracker Phase 4 (Email-to-task, T5) — каждое письмо, прошедшее через
   * IMAP-polling. `status` ∈ received | bounced | failed | created.
   *
   * `projectId` может быть пустой строкой, если письмо bounced (alias не
   * найден); для bounced дополнительно зовётся `incMailInboundBounce`.
   */
  incMailInboundReceived(args: {
    projectId: string;
    status: 'received' | 'bounced' | 'failed' | 'created';
  }): void {
    this.mailInboundReceivedTotal.inc({
      project_id: args.projectId,
      status: args.status,
    });
  }

  /** Tracker Phase 4 (Email-to-task, T5) — Issue.create() удалось. */
  incMailInboundIssueCreated(): void {
    this.mailInboundIssuesCreatedTotal.inc();
  }

  /**
   * Tracker Phase 4 (Email-to-task, T5) — письмо ушло в bounce.
   * `reason` ∈ alias_not_found | disabled | parse_error | no_project_member.
   */
  incMailInboundBounce(args: { reason: string }): void {
    this.mailInboundBounceTotal.inc({ reason: args.reason });
  }

  /** Tracker Phase 4 (Email-to-task, T5) — вложение из письма сохранено в S3. */
  incMailInboundAttachmentUploaded(): void {
    this.mailInboundAttachmentUploadedTotal.inc();
  }

  /**
   * Wave 3 finishing (Sprint 10, 2026-05-24) — probe «goal_alignment_low»
   * успешно отправлен. Cardinality-safe label `tenant_top` (top-100 + 'other').
   */
  incProbeGoalAlignmentLowEmitted(args: { tenantTop: string }): void {
    this.probeGoalAlignmentLowEmittedTotal.inc({ tenant_top: args.tenantTop });
  }

  /**
   * Tracker Phase 5 part 1 (2026-05-24) — Import-tracker:
   *  - запуск импорта (`import_started_total`).
   */
  incImportStarted(args: {
    tenantTop: string;
    source: 'trello' | 'bitrix24' | 'yandex_tracker';
  }): void {
    this.importStartedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
    });
  }

  /**
   * Tracker Phase 5 part 1 (2026-05-24) — финальное завершение импорта.
   * `success` ∈ 'true' (status='completed') | 'false' (status='failed'|'cancelled').
   */
  incImportCompleted(args: {
    tenantTop: string;
    source: 'trello' | 'bitrix24' | 'yandex_tracker';
    success: boolean;
  }): void {
    this.importCompletedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
      success: String(args.success),
    });
  }

  /**
   * Tracker Phase 5 part 1 (2026-05-24) — обработан очередной Issue
   * (либо создан, либо пропущен по идемпотентности).
   */
  incImportIssueProcessed(args: {
    tenantTop: string;
    source: 'trello' | 'bitrix24' | 'yandex_tracker';
    by?: number;
  }): void {
    this.importIssuesProcessedTotal.inc(
      { tenant_top: args.tenantTop, source: args.source },
      args.by ?? 1,
    );
  }

  // ── Wave 2 Поток D — Activity Feeds (2026-05-24) ────────────────────

  /** Activity Feeds — публикация новой записи (ActivityFeedService.publish). */
  incFeedItemEmitted(args: {
    tenant: string;
    feedType: string;
    severity: string;
  }): void {
    this.feedItemsEmittedTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      severity: args.severity,
    });
  }

  /**
   * Activity Feeds — пользователь произвёл действие над записью
   * (markSeen / markDelivered / markResponded / markActioned / dismiss).
   */
  incFeedItemActioned(args: {
    tenant: string;
    feedType: string;
    status: string;
  }): void {
    this.feedItemsActionedTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      status: args.status,
    });
  }

  /** Activity Feeds — реакция пользователя (thanks / vote). */
  incFeedReaction(args: {
    tenant: string;
    feedType: string;
    reaction: string;
  }): void {
    this.feedReactionsTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      reaction: args.reaction,
    });
  }

  /** Activity Feeds — запись истекла по expiresAt (cron). */
  incFeedItemExpired(args: { tenant: string; feedType: string }): void {
    this.feedItemsExpiredTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
    });
  }

  // ────────────────────── Calendar MVP (2026-05-25) ───────────────────

  /** Создание события календаря (POST /api/v1/events). */
  incCalendarEventCreated(args: {
    tenant: string;
    kind: string;
    visibility: string;
  }): void {
    this.calendarEventsCreatedTotal.inc({
      tenant: args.tenant,
      kind: args.kind,
      visibility: args.visibility,
    });
  }

  /** Доставка напоминания по каналу (EventRemindersWorker). */
  incCalendarReminderSent(args: {
    tenant: string;
    channel: string;
    success: boolean;
  }): void {
    this.calendarRemindersSentTotal.inc({
      tenant: args.tenant,
      channel: args.channel,
      success: args.success ? 'true' : 'false',
    });
  }

  /** Вызов POST /api/v1/events/find-free-slot. */
  incCalendarFindFreeSlot(args: { tenant: string; found: boolean }): void {
    this.calendarFindFreeSlotTotal.inc({
      tenant: args.tenant,
      found: args.found ? 'true' : 'false',
    });
  }

  // ────────────────────── Feedback (ТЗ 2026-05-25) ────────────────────

  /**
   * Прогон FeedbackDigestService.runDigest() завершён.
   * result ∈ success | skipped | lock_held | agent_failed | txn_failed | anomaly.
   */
  incFeedbackDigestRun(args: {
    result:
      | 'success'
      | 'skipped'
      | 'lock_held'
      | 'agent_failed'
      | 'txn_failed'
      | 'anomaly';
  }): void {
    this.feedbackDigestRunsTotal.inc({ result: args.result });
  }

  /**
   * Сколько FeedbackMessage реально обработано (инкремент на размер батча
   * после успешной транзакции).
   */
  incFeedbackDigestMessagesProcessed(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestMessagesProcessedTotal.inc(by);
  }

  /** Создано новых FeedbackTopic за прогон. */
  incFeedbackDigestNewTopics(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestNewTopicsTotal.inc(by);
  }

  /** Сообщения, у которых failedRuns достиг 3 (хронически невалидные). */
  incFeedbackDigestFailedRuns(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestFailedRunsTotal.inc(by);
  }

  // ── Onboarding Tour (ТЗ 2026-05-27) ───────────────────────────────────

  /** Тур начат (первый PATCH без completedAt/skipped). */
  incTourStarted(args: { tenant: string; tour_id: string }): void {
    this.tourStartedTotal.inc({ tenant: args.tenant, tour_id: args.tour_id });
  }

  /** Тур завершён (PATCH с completedAt). */
  incTourCompleted(args: { tenant: string; tour_id: string }): void {
    this.tourCompletedTotal.inc({
      tenant: args.tenant,
      tour_id: args.tour_id,
    });
  }

  /** Тур пропущен (PATCH с skipped=true). `at_step` — id шага или 'unknown'. */
  incTourSkipped(args: {
    tenant: string;
    tour_id: string;
    at_step: string;
  }): void {
    this.tourSkippedTotal.inc({
      tenant: args.tenant,
      tour_id: args.tour_id,
      at_step: args.at_step,
    });
  }

  // ── Sprints (ТЗ 2026-05-27) ───────────────────────────────────────────

  incCycleCreated(args: {
    tenant: string;
    scopeKind: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
  }): void {
    this.cyclesCreatedTotal.inc({ tenant: args.tenant, scope_kind: args.scopeKind });
  }

  incCycleCompleted(args: { tenant: string }): void {
    this.cyclesCompletedTotal.inc({ tenant: args.tenant });
  }

  incSprintHint(args: {
    tenant: string;
    kind: string;
    status: 'active' | 'dismissed' | 'resolved';
  }): void {
    this.sprintHintsTotal.inc({
      tenant: args.tenant,
      kind: args.kind,
      status: args.status,
    });
  }

  incSprintHintDismissed(args: { tenant: string; kind: string }): void {
    this.sprintHintDismissedTotal.inc({ tenant: args.tenant, kind: args.kind });
  }

  incSprintDashboardCacheHit(args: { tenant: string }): void {
    this.sprintDashboardCacheHitTotal.inc({ tenant: args.tenant });
  }

  incSprintDashboardCacheMiss(args: { tenant: string }): void {
    this.sprintDashboardCacheMissTotal.inc({ tenant: args.tenant });
  }

  incSprintHelperRun(args: {
    tenant: string;
    status: 'success' | 'failed' | 'skipped';
  }): void {
    this.sprintHelperRunsTotal.inc({ tenant: args.tenant, status: args.status });
  }

  observeSprintHelperDuration(args: { tenant: string; seconds: number }): void {
    this.sprintHelperDurationSeconds.observe({ tenant: args.tenant }, args.seconds);
  }

  incSprintReviewGeneration(args: {
    tenant: string;
    status: 'ready' | 'failed' | 'retried';
  }): void {
    this.sprintReviewGenerationTotal.inc({
      tenant: args.tenant,
      status: args.status,
    });
  }

  observeSprintReviewGenerationDuration(args: {
    tenant: string;
    seconds: number;
  }): void {
    this.sprintReviewGenerationDurationSeconds.observe(
      { tenant: args.tenant },
      args.seconds,
    );
  }

  // ────────────────── Agents v2 Фаза A1 — Bi-temporal edges ─────────────

  /**
   * Закрытие существующего open-link'а через TemporalConflictService
   * (validUntil=NOW). relationType — закрытого link'а.
   */
  incTemporalEdgesInvalidated(args: { relationType: string }): void {
    this.temporalEdgesInvalidatedTotal.inc({
      relationType: args.relationType,
    });
  }

  /**
   * Каждое решение bi-temporal retrieval-фильтра по конкретному edge.
   * 'passed' — edge валиден на момент validAt; 'filtered_out' — отсеян.
   */
  incTemporalFilterHit(args: { result: 'passed' | 'filtered_out' }): void {
    this.temporalFilterHitsTotal.inc({ result: args.result });
  }

  /**
   * Snapshot-метрика: сколько edges (block|entity) имеют непустые
   * bi-temporal поля. Обновляется ежечасным cron'ом.
   */
  setEdgesWithTemporal(args: { type: 'block' | 'entity'; value: number }): void {
    this.edgesWithTemporalTotal.set({ type: args.type }, args.value);
  }

  // ────────────────── Agents v2 Фаза A2 — Multi-Agent Debate ────────────

  /**
   * Финальный verdict одного debate-run'а.
   *   - `taskType` — `debate-decision-supersede` (зонтичный).
   *   - `decision` — `new` | `merge` | `supersedes` | `split_uncertain` | …
   *   - `consensusType` — `unanimous` | `majority` | `split`.
   */
  incDebateJudgment(args: {
    taskType: string;
    decision: string;
    consensusType: 'unanimous' | 'majority' | 'split';
  }): void {
    this.debateJudgmentsTotal.inc({
      task_type: args.taskType,
      decision: args.decision,
      consensus_type: args.consensusType,
    });
  }

  /**
   * Прибавить USD-cost debate-run'а к суммарному счётчику.
   * `tenantTop` уже нормализован caller'ом через `tenantTopOf`.
   */
  incDebateCost(args: {
    tenantTop: string;
    taskType: string;
    costUsd: number;
  }): void {
    if (args.costUsd <= 0) return;
    this.debateCostUsdTotal.inc(
      { tenant_top: args.tenantTop, task_type: args.taskType },
      args.costUsd,
    );
  }

  /** Round 2 был запущен при split-verdict'е round 1. */
  incDebateRound2Triggered(args: { taskType: string }): void {
    this.debateRound2TriggeredTotal.inc({ task_type: args.taskType });
  }

  /**
   * Пара провайдеров, которые НЕ согласились в round 1. Для cardinality-
   * стабильности — сортируем `providerA < providerB` лексикографически
   * на стороне caller'а (см. `MultiAgentDebateService`).
   */
  incDebateProviderDisagreement(args: {
    providerA: string;
    providerB: string;
    taskType: string;
  }): void {
    this.debateProviderDisagreementTotal.inc({
      provider_a: args.providerA,
      provider_b: args.providerB,
      task_type: args.taskType,
    });
  }

  /**
   * Debate сорвался, специалист вернулся к одиночному LLM-вызову.
   * reason ∈ `cost_cap` | `provider_unavailable`.
   */
  incDebateFallbackToSingle(args: {
    reason: 'cost_cap' | 'provider_unavailable';
  }): void {
    this.debateFallbackToSingleTotal.inc({ reason: args.reason });
  }

  incVoxOutcome(outcome: 'ok' | 'empty' | 'no_words'): void {
    this.voxOutcomeTotal.inc({ outcome });
  }

  incRecordingTrackWatchdog(args: { outcome: 'forced' | 'skipped' }): void {
    this.recordingTrackWatchdogTotal.inc({ outcome: args.outcome });
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
