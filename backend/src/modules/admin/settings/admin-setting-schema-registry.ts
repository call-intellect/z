import { z, type ZodTypeAny } from 'zod';

export const MIN_REASON_LENGTH = 10;

const POSITIVE_INT = z.number().int().positive();
const NON_NEGATIVE_INT = z.number().int().nonnegative();
const UNIT_INTERVAL = z.number().min(0).max(1);

const registry = new Map<string, ZodTypeAny>([
  ['knowledge.distillMergeThreshold', UNIT_INTERVAL],
  ['knowledge.entityMergeThreshold', UNIT_INTERVAL],
  ['knowledge.entityConsolidateSameNameEnabled', z.boolean()],
  ['knowledge.entityConsolidateSameNameBatchSize', POSITIVE_INT],
  ['knowledge.entity_name_resolve_threshold', UNIT_INTERVAL],
  ['knowledge.themeCosineThreshold', UNIT_INTERVAL],
  ['theme.autofill.enabled', z.boolean()],
  ['theme.autofill.threshold', UNIT_INTERVAL],
  ['theme.autofill.scanWindowDays', POSITIVE_INT],
  ['theme.autofill.maxPerScan', POSITIVE_INT],
  ['theme.autofill.dedupeSimilarity', UNIT_INTERVAL],
  ['knowledge.ideaClusterThreshold', UNIT_INTERVAL],
  ['knowledge.insightClusterThreshold', UNIT_INTERVAL],
  ['knowledge.searchCosineWeight', UNIT_INTERVAL],
  ['knowledge.searchBm25Weight', UNIT_INTERVAL],
  ['knowledge.linkMinConfidence', UNIT_INTERVAL],
  ['knowledge.skillTraitSimilarityThreshold', UNIT_INTERVAL],
  ['knowledge.skillClusterSimilarityThreshold', UNIT_INTERVAL],
  ['knowledge.curationAutoThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationDeepReviewThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationStaleDynamicScoreThreshold', UNIT_INTERVAL],
  ['knowledge.reportBlockConfidenceCap', UNIT_INTERVAL],
  ['knowledge.edge_confidence_high', UNIT_INTERVAL],
  ['knowledge.edge_confidence_low', UNIT_INTERVAL],
  ['knowledge.conflict_min_confidence', UNIT_INTERVAL],
  ['knowledge.conflict_graph_confidence', UNIT_INTERVAL],
  ['knowledge.curationProvisionalThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationAuditSampleRate', UNIT_INTERVAL],
  ['knowledge.curationGrayZoneJudgeMinConfidence', UNIT_INTERVAL],
  ['knowledge.curationGrayZoneJudgeSampleRate', UNIT_INTERVAL],
  ['knowledge.curationThresholdMin', UNIT_INTERVAL],
  ['knowledge.curationThresholdMax', UNIT_INTERVAL],
  ['knowledge.curationAutotuneStep', UNIT_INTERVAL],
  ['knowledge.curationMaxProvisionalOverride', UNIT_INTERVAL],
  ['knowledge.insightSpikeRatio', z.number().min(0).max(100)],
  ['knowledge.decisionsExtractMinConfidence', UNIT_INTERVAL],
  ['knowledge.ideasExtractMinConfidence', UNIT_INTERVAL],
  ['knowledge.insightsExtractMinConfidence', UNIT_INTERVAL],
  ['knowledge.decisionsDedupeThreshold', UNIT_INTERVAL],
  ['knowledge.decisionsDedupeGrayBand', UNIT_INTERVAL],

  ['knowledge.distillDebounceMs', POSITIVE_INT],
  ['knowledge.distillKnnTopK', POSITIVE_INT],
  ['knowledge.regulationDedupeTopK', POSITIVE_INT],
  ['knowledge.blockIngestWindowSegments', POSITIVE_INT],
  ['knowledge.blockIngestMaxTokensPerSegment', POSITIVE_INT],
  ['knowledge.specialistsCombinedDelayMs', NON_NEGATIVE_INT],
  ['knowledge.specialistsCombinedRepairTimeoutMs', POSITIVE_INT],
  ['knowledge.blockIngestWindowOverlapSegments', NON_NEGATIVE_INT],
  ['knowledge.blockIngestGleaningRounds', z.number().int().min(0).max(3)],
  ['knowledge.blockIngestGleaningMinSegments', POSITIVE_INT],
  ['knowledge.skeletonMinSegments', POSITIVE_INT],
  ['knowledge.document_summary_input_chars', z.number().int().min(500).max(60000)],
  ['knowledge.segment_max_tokens', z.number().int().min(200).max(2000)],
  ['knowledge.segment_overlap_ratio', UNIT_INTERVAL],
  ['knowledge.contextual_header_enabled', z.boolean()],
  ['knowledge.theme_summary_enabled', z.boolean()],
  ['knowledge.demoOrgIngestEnabled', z.boolean()],
  ['knowledge.specialists_combined_enabled', z.boolean()],
  ['knowledge.skeleton_pass_enabled', z.boolean()],
  ['knowledge.header_map_enabled', z.boolean()],
  ['knowledge.rawEventRecoveryEnabled', z.boolean()],
  ['knowledge.rawEventRecoveryStaleMinutes', POSITIVE_INT],
  ['knowledge.rawEventRecoveryMaxAgeHours', POSITIVE_INT],
  ['knowledge.rawEventRecoveryBatchLimit', POSITIVE_INT],
  ['knowledge.linkerMinBlocks', POSITIVE_INT],
  ['knowledge.linker_min_canonical', POSITIVE_INT],
  ['knowledge.linker_candidate_topk', POSITIVE_INT],
  ['knowledge.structural_shares_entity_topk', POSITIVE_INT],
  ['knowledge.search_expand_hops', z.number().int().min(0).max(3)],
  ['knowledge.search_rrf_k', POSITIVE_INT],
  ['knowledge.hnsw_ef_search', z.number().int().min(1).max(1000)],
  ['knowledge.router_confidence_threshold', UNIT_INTERVAL],
  ['knowledge.router_v2_enabled', z.boolean()],
  ['knowledge.overview_top_themes', POSITIVE_INT],
  ['knowledge.list_episodes_limit', POSITIVE_INT],
  ['knowledge.person_resolve_trgm_threshold', UNIT_INTERVAL],
  ['knowledge.person_resolve_ambiguity_delta', UNIT_INTERVAL],
  ['knowledge.linkKnnTopK', POSITIVE_INT],
  ['knowledge.blockDynamicScoreDecayDays', POSITIVE_INT],
  ['knowledge.entityGraphMinComentions', POSITIVE_INT],
  ['knowledge.entityGraphPairsPerOrg', POSITIVE_INT],
  ['knowledge.themeClusteringMinBlocks', POSITIVE_INT],
  ['knowledge.themeClusterMinSize', POSITIVE_INT],
  ['knowledge.cardRollupV2DebounceMs', POSITIVE_INT],
  ['knowledge.meetingAnalyzeV2DebounceMs', POSITIVE_INT],
  ['knowledge.chatV2TopBlocks', POSITIVE_INT],
  ['knowledge.chatV2GraphHops', POSITIVE_INT],
  ['knowledge.chatV2SynthesisTimeoutMs', POSITIVE_INT],
  ['knowledge.chatV2GraphAlwaysExpand', z.boolean()],
  ['knowledge.chatV2FilterMode', z.enum(['boost', 'hard'])],
  ['knowledge.chatV2FilterBoostWeight', UNIT_INTERVAL],
  ['knowledge.chatV2EntityLinkHops', z.number().int().min(0).max(1)],
  ['knowledge.chatV2CascadeEnabled', z.boolean()],
  ['knowledge.chatV2CascadeMinPool', POSITIVE_INT],
  ['knowledge.chatV2AggregationMode', z.boolean()],
  ['knowledge.chatV2UnderstandGrounding', z.boolean()],
  ['knowledge.chatV2GroundingTopK', POSITIVE_INT],
  ['knowledge.chatV2AdaptiveHops', z.boolean()],
  ['knowledge.chatV2AssertiveSynthesis', z.boolean()],
  ['knowledge.chatV2GroundednessMode', z.enum(['off', 'shadow', 'lenient', 'on'])],
  ['knowledge.chatV2GroundingEmbedding', z.boolean()],
  ['knowledge.chatV2GroundingEmbeddingTopK', POSITIVE_INT],
  ['knowledge.chatV2GroundingEmbeddingMinSim', UNIT_INTERVAL],
  ['knowledge.chatV2DeterministicPeriod', z.boolean()],
  ['knowledge.chatV2GraphCypherRecall', z.boolean()],
  ['knowledge.chatV2GraphCypherMaxDepth', POSITIVE_INT],
  ['knowledge.chatV2BaseRecallFloor', z.boolean()],
  ['knowledge.graphReconcileEnabled', z.boolean()],
  ['knowledge.graphReconcileBatchSize', POSITIVE_INT],
  ['knowledge.insightFrequencyWindowDays', POSITIVE_INT],
  ['knowledge.ideaMinSupportersForCluster', POSITIVE_INT],
  ['knowledge.skillMinObservations', POSITIVE_INT],
  ['knowledge.skillLookbackMonths', POSITIVE_INT],
  ['knowledge.skillDecayMonths', POSITIVE_INT],
  ['knowledge.skillArchiveMonths', POSITIVE_INT],
  ['knowledge.personaMinTraits', POSITIVE_INT],
  ['knowledge.personaRoleAggMinPersons', POSITIVE_INT],
  ['knowledge.curationItemExpiryDays', POSITIVE_INT],
  ['knowledge.curationStaleMonthsThreshold', POSITIVE_INT],
  ['knowledge.curationMinDecisionsForAutotune', POSITIVE_INT],
  ['knowledge.executablePersonaThresholdTraitsCount', POSITIVE_INT],

  ['knowledge.v2AgentsEnabled', z.boolean()],
  ['knowledge.chatV2Enabled', z.boolean()],
  ['knowledge.curationAiVerifierEnabled', z.boolean()],
  ['knowledge.curationGrayZoneJudgeEnabled', z.boolean()],
  ['knowledge.curationAutotuneEnabled', z.boolean()],
  ['knowledge.subjectAttributionEnabled', z.boolean()],
  ['knowledge.subjectAttributionAllTypes', z.boolean()],
  ['knowledge.ideaDirectPathEnabled', z.boolean()],

  ['clone.regulations.retrieval.top_n', POSITIVE_INT],
  ['clone.regulations.retrieval.min_similarity', UNIT_INTERVAL],
  ['clone.regulations.snapshot.max_items', POSITIVE_INT],
  ['clone.regulations.scope.include_org', z.boolean()],
  ['clone.regulations.router.enabled', z.boolean()],
  ['clone.regulations.router.model', z.string()],
  ['clone.regulations.router.max_tokens', POSITIVE_INT],
  ['clone.regulations.router.max_pool', POSITIVE_INT],
  ['clone.regulations.router.context_level', z.enum(['names', 'summary', 'fulltext'])],
  ['clone.regulations.summary.enabled', z.boolean()],
  ['clone.regulations.summary.model', z.string()],
  ['clone.regulations.summary.max_tokens', POSITIVE_INT],
  ['clone.regulations.summary.batch', POSITIVE_INT],
  ['clone.topic.similarityThreshold', UNIT_INTERVAL],
  ['clone.topic.similarityThresholdJudgmental', UNIT_INTERVAL],
  ['clone.topic.minBlocks', NON_NEGATIVE_INT],
  ['clone.retrieval.topK', POSITIVE_INT],
  ['clone.retrieval.base_recall_floor', z.boolean()],
  ['clone.v2.enabled', z.boolean()],
  ['clone.grounding.accept_topic_match', z.boolean()],
  ['knowledgeClone.profileMinConfidence', UNIT_INTERVAL],

  ['companyProfile.autoSummaryEnabled', z.boolean()],
  ['companyProfile.summaryRebuildHours', POSITIVE_INT],
  ['companyProfile.summaryMinSourceBlocks', POSITIVE_INT],
  ['companyProfile.completenessProbeEnabled', z.boolean()],

  ['taskRouting.enabled', z.boolean()],
  ['taskRouting.suggestMinConfidence', UNIT_INTERVAL],
  ['taskRouting.autoAssignMinConfidence', UNIT_INTERVAL],
  ['taskRouting.topK', POSITIVE_INT],

  ['meetings.taskDedupeEnabled', z.boolean()],
  ['meetings.taskDedupeThreshold', UNIT_INTERVAL],

  ['graph.ageEnabled', z.boolean()],

  ['rag.rrf_k', POSITIVE_INT],
  ['rag.k_retrieve', POSITIVE_INT],
  ['rag.k_context', POSITIVE_INT],
  ['rag.rerank_min_pool', POSITIVE_INT],
  ['rag.rerank_pool_size', POSITIVE_INT],
  ['rag.multiquery_count', POSITIVE_INT],
  ['rag.groundedness_mode', z.enum(['off', 'shadow', 'on'])],
  ['rag.iterative_enabled', z.boolean()],
  ['rag.cold_start_min_blocks', NON_NEGATIVE_INT],
  ['rag.understanding_merged', z.boolean()],

  ['aiFeatures.summaryAgentEnabled', z.boolean()],
  ['aiFeatures.regulationMinMaterializeConfidence', UNIT_INTERVAL],
  ['aiFeatures.regulationConsolidatorEnabled', z.boolean()],
  ['aiFeatures.taskSolutionEnabled', z.boolean()],
  ['aiFeatures.clientProtocolEnabled', z.boolean()],
  ['aiFeatures.analyzeWorkerRouterEnabled', z.boolean()],

  ['llm.budget.enforce_enabled', z.boolean()],
  ['llm.budget.currencyRateFallbackUsdRub', z.number().positive()],
  ['llm.budget.default_monthly_cap_rub', z.number().nonnegative()],

  ['llm.cacheSmokeEnabled', z.boolean()],
  ['llm.cacheHitRatioWarnThreshold', UNIT_INTERVAL],
  // Ф6 llm-providers-models-routing-admin (2026-07-02, Б11) — дефолт-цепочка
  // провайдеров для taskType без явного маршрута (primary→secondary→tertiary).
  [
    'llm.router.defaultChain',
    z
      .array(z.object({ provider: z.string(), model: z.string().nullable().optional() }))
      .min(1)
      .max(5),
  ],

  ['embeddings.provider', z.string().trim().min(1)],
  ['embeddings.model', z.string().trim().min(1)],
  ['embeddings.dimensions', POSITIVE_INT],
  ['embeddings.fallbackLocalUrl', z.string()],
  ['embeddings.batchSize', POSITIVE_INT],
  ['embeddings.chunkTargetTokens', POSITIVE_INT],
  ['embeddings.chunkOverlapTokens', NON_NEGATIVE_INT],

  ['feature.tables_text_to_schema', z.boolean()],
  // База знаний редизайн (2026-06-16) — kill-switch новой раскладки раздела.
  ['knowledge_base.redesign.enabled', z.boolean()],

  ['table.agent.confirmation_threshold', UNIT_INTERVAL],
  ['table.agent.draft_ttl_days', POSITIVE_INT],
  ['table.agent.max_concurrent_enrich_jobs_per_org', POSITIVE_INT],
  ['table.agent.max_daily_tokens', POSITIVE_INT],

  ['table.graphsync.enabled', z.boolean()],
  ['table.graphsync.min_confidence', UNIT_INTERVAL],

  ['table.import.dedup_threshold', UNIT_INTERVAL],

  ['chat_v2.table_context_enabled', z.boolean()],
  ['chat_v2.table_context_max_rows', POSITIVE_INT],
  ['chat_v2.table_context_max_tables', POSITIVE_INT],
  ['chat_v2.table_context_max_rows_per_entity_table', POSITIVE_INT],
  ['chat_v2.table_structural_query_classes', z.array(z.string())],
  ['chat_v2.table_generic_stopwords', z.array(z.string())],

  ['tracker.autoAcceptConfidenceThreshold', UNIT_INTERVAL],
  ['intake.autoAcceptSources', z.array(z.string())],

  ['proactive.eveningPlanCheckEnabled', z.boolean()],
  ['proactive.planItemOverdueThresholdDays', z.number().int().min(1).max(90)],

  ['goals.pulse.enabled', z.boolean()],
  ['goals.pulse.deliver_to_telegram', z.boolean()],

  ['goals.themeAutolinkMinWeight', UNIT_INTERVAL],
  ['goals.themeAutolinkLlmEnabled', z.boolean()],

  ['goals.goalTaskLinkEnabled', z.boolean()],

  ['goals.minExtractConfidence', z.coerce.number()],
  ['goals.autoPromoteConfidence', z.coerce.number()],
  ['goals.maxActiveGoalsPerHorizon', z.coerce.number()],

  ['goals.krTrendWindowDays', POSITIVE_INT],
  ['goals.krAtRiskMargin', z.coerce.number()],
  ['goals.issueSnapshotCacheTtlSec', POSITIVE_INT],
  ['goals.recentActivityWindowDays', POSITIVE_INT],
  ['goals.misalignmentWindowDays', POSITIVE_INT],
  ['goals.misalignmentMinIssues', POSITIVE_INT],
  ['goals.misalignmentRatioThreshold', UNIT_INTERVAL],
  ['goals.knnTopK', POSITIVE_INT],
  ['goals.alignmentMaxBlocks', POSITIVE_INT],
  ['goals.alignmentAlertDelta', z.coerce.number()],
  ['goals.alignmentAlertScore', z.coerce.number()],
  ['goals.vectorMaxOrgsPerRun', POSITIVE_INT],
  ['goals.vectorMaxArtefactsPerGoal', POSITIVE_INT],
  ['goals.linkerPerOrgLimit', POSITIVE_INT],
  ['goals.taskLinkerLookbackDays', POSITIVE_INT],
  ['goals.themeAutolinkKnnMaxDistance', UNIT_INTERVAL],
  ['goals.themeAutolinkKnnTopK', POSITIVE_INT],

  ['provenance.confidence_review_threshold', UNIT_INTERVAL],
  ['provenance.voiceNoteAudioRetentionDays', POSITIVE_INT],
  ['provenance.voiceNoteAudioPresignTtlSeconds', POSITIVE_INT],
  ['provenance.frictionVerbatimRoles', z.array(z.string())],
  ['probe.reply_latency_rise.factor', z.number().positive()],
  ['probe.workload_overload.load_percent', POSITIVE_INT],
  ['probe.meeting_noshows.count', POSITIVE_INT],
  ['probe.digestTouchCap', POSITIVE_INT],
  ['probe.digestHourUtc', z.number().int().min(0).max(23)],
  ['probe.digestEnabled', z.boolean()],
  ['probe.topicCooldownHours', POSITIVE_INT],
  ['probe.adaptiveFatigueEnabled', z.boolean()],
  // Probe Фаза 2 (2026-06-17) — порог уверенности для распознавания свободного
  // ответа на probe во входном классификаторе (Telegram без reply / MAX).
  ['probe.replyClassifyMinConfidence', UNIT_INTERVAL],
  ['probe.implicit_match_max_age_days', POSITIVE_INT],
  // Probe Фаза 2 (2026-06-17) — kill-switch LLM-судьи качества формулировки
  // probe-вопроса (один регенерат при браке). ON.
  ['probe.qualityJudgeEnabled', z.boolean()],
  // Probe Фаза 3 (2026-06-17) — kill-switch выбора получателя probe по
  // engagement-снимку (самый отзывчивый из кандидатов). ON.
  ['probe.engagementRoutingEnabled', z.boolean()],
  // Probe Фаза 4 (2026-06-17) — семантический дедуп близких по смыслу probe
  // по эмбеддингу вопроса (рубильник ON · cosine-порог · окно поиска в часах).
  ['probe.semanticDedupEnabled', z.boolean()],
  ['probe.recipientAwareDedupEnabled', z.boolean()],
  ['probe.semanticDedupThreshold', UNIT_INTERVAL],
  ['probe.semanticDedupWindowHours', POSITIVE_INT],
  // Probe Фаза 5 (2026-06-17) — kill-switch одного переспроса (re-ask) при
  // истечении неотвеченного probe (переформулировать и спросить ещё раз). ON.
  ['probe.reaskEnabled', z.boolean()],
  ['probe.valueGateEnabled', z.boolean()],
  ['probe.digestFormulateEnabled', z.boolean()],

  ['probe.dedupTtlHours', POSITIVE_INT],
  ['probe.rateLimitPerHour', POSITIVE_INT],
  ['probe.rateLimitPerDay', POSITIVE_INT],
  ['probe.expiryDays', POSITIVE_INT],
  ['probe.quietHoursDefaultTzOffsetMin', z.number().int()],
  ['probe.coldStartModeHours', NON_NEGATIVE_INT],
  ['probe.responseClassifyEnabled', z.boolean()],
  ['probe.subjectAddressingEnabled', z.boolean()],
  ['probe.voiceInputEnabled', z.boolean()],
  ['probe.responseClassifyMinConfidence', UNIT_INTERVAL],
  ['probe.confirmGraceDays', NON_NEGATIVE_INT],
  ['probe.suppressOnUnconfirmedAuto', z.boolean()],
  ['probe.existenceConfirmEnabled', z.boolean()],
  ['probe.machineFillableReasons', z.array(z.string())],
  ['probe.draftReasons', z.array(z.string())],
  ['probe.dialogEnabled', z.boolean()],
  ['probe.dialogEscalateMaxConfidence', UNIT_INTERVAL],
  ['probe.dialogMaxTurns', POSITIVE_INT],
  ['probe.dialogConfirmTtlHours', POSITIVE_INT],

  ['subjectMemory.enabled', z.boolean()],
  ['subjectMemory.retrieveBeforeAskEnabled', z.boolean()],
  ['subjectMemory.sweepPendingOnLearnEnabled', z.boolean()],
  ['subjectMemory.matchMinSimilarity', UNIT_INTERVAL],
  ['subjectMemory.suppressMinConfidence', UNIT_INTERVAL],
  ['subjectMemory.canaryRollbackWindowHours', POSITIVE_INT],
  ['subjectMemory.ttlDays', POSITIVE_INT],
  ['subjectMemory.judgeQuorum', POSITIVE_INT],
  ['subjectMemory.shadowToCanaryMinConfirm', NON_NEGATIVE_INT],
  ['subjectMemory.judgeModels', z.array(z.string())],

  ['dayReport.enabled', z.boolean()],
  ['dayReport.completenessQualityThreshold', UNIT_INTERVAL],

  ['daily-checkin.skipNonWorkingDays', z.boolean()],
  ['daily-checkin.skipHolidays', z.boolean()],
  ['daily-checkin.staleDaysThreshold', z.number().int().min(1).max(30)],

  ['blocker_synthesis.lookback_days', POSITIVE_INT],
  ['blocker_synthesis.recurring_days', POSITIVE_INT],
  ['blocker_synthesis.impact.base', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.customer', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.deadline', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.commitment', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.per_day_open', z.number().nonnegative()],
  ['operations.blocker_synthesis.enabled', z.boolean()],

  ['ideas.feed.rerank.weight', z.number().nonnegative()],
  ['ideas.feed.rerank.freshness', z.number().nonnegative()],
  ['ideas.feed.rerank.goal_link', z.number().nonnegative()],
  ['ideas.feed.freshness_days', POSITIVE_INT],
  ['ideas.feed.enabled', z.boolean()],
  ['insight.recheck_days', POSITIVE_INT],
  ['insights.recheck.enabled', z.boolean()],
  ['operations.knowledge_at_risk.enabled', z.boolean()],
  ['team_capacity.overload_percent', POSITIVE_INT],
  ['team_capacity.underload_percent', NON_NEGATIVE_INT],
  ['operations.team_capacity.enabled', z.boolean()],
  ['onboarding.silent_days', POSITIVE_INT],
  ['operations.onboarding_ramp.enabled', z.boolean()],

  ['operations.per_person_self_view.enabled', z.boolean()],

  ['me.daily_value_widgets.enabled', z.boolean()],

  ['billing.baseMonthlyKopecks', NON_NEGATIVE_INT],
  ['billing.perExtraSeatKopecks', NON_NEGATIVE_INT],
  ['billing.yearlyDiscountRate', UNIT_INTERVAL],
  ['billing.baseSeatsIncluded', POSITIVE_INT],
  ['billing.baseMeetingsGrant', NON_NEGATIVE_INT],
  ['billing.perExtraSeatMeetingsGrant', NON_NEGATIVE_INT],
  ['billing.meetingUploadsPerMonth', POSITIVE_INT],

  ['notifications.daily_budget.per_person', POSITIVE_INT],
  ['notifications.quiet_hours.start', z.number().int().min(0).max(23)],
  ['notifications.quiet_hours.end', z.number().int().min(0).max(23)],
  ['notifications.daily_budget.enabled', z.boolean()],
  ['notifications.binding_campaign.enabled', z.boolean()],

  ['customer_risk.window_days', POSITIVE_INT],
  ['customer_risk.weight.churn_risk', NON_NEGATIVE_INT],
  ['customer_risk.weight.objection', NON_NEGATIVE_INT],
  ['customer_risk.weight.pain', NON_NEGATIVE_INT],
  ['customer_risk.weight.feature_request', NON_NEGATIVE_INT],
  ['customer_risk.threshold.critical', NON_NEGATIVE_INT],
  ['customer_risk.threshold.warning', NON_NEGATIVE_INT],
  ['operations.customer_risk_radar.enabled', z.boolean()],

  ['portfolio.health.threshold_healthy', NON_NEGATIVE_INT],
  ['portfolio.health.threshold_warning', NON_NEGATIVE_INT],
  ['portfolio.health.weight_achieved', NON_NEGATIVE_INT],
  ['portfolio.health.weight_on_track', NON_NEGATIVE_INT],
  ['portfolio.health.weight_at_risk', NON_NEGATIVE_INT],
  ['portfolio.health.weight_stalled', NON_NEGATIVE_INT],
  ['portfolio.health.weight_dropped', NON_NEGATIVE_INT],
  ['operations.portfolio_health.enabled', z.boolean()],

  ['documents.maxSizeMb', POSITIVE_INT],
  ['documents.maxFilesPerUpload', POSITIVE_INT],
  ['documents.acceptedFormats', z.array(z.string())],
  ['documents.maxZipSizeMb', POSITIVE_INT],
  ['documents.short_text_to_idea_threshold', z.number().int().min(1).max(5000)],

  ['pendingActions.reminderWindowStartHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderWindowEndHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderStepHours', POSITIVE_INT],
  ['pendingActions.urgentAgeDays', POSITIVE_INT],
  ['pendingActions.reminderLeadDays', POSITIVE_INT],

  ['concierge.enabled', z.boolean()],
  ['concierge.dialogLayerEnabled', z.boolean()],
  ['concierge.nativeToolsEnabled', z.boolean()],
  ['concierge.prmShadowEnabled', z.boolean()],
  ['concierge.prmEnabled', z.boolean()],
  ['concierge.prmTopK', POSITIVE_INT],
  ['concierge.prmShadowSampleRate', UNIT_INTERVAL],
  ['concierge.dailyMessagesLimit', POSITIVE_INT],
  ['concierge.monthlyMessagesLimit', POSITIVE_INT],
  ['concierge.sseHeartbeatSeconds', POSITIVE_INT],
  ['concierge.preRetrievalTopK', POSITIVE_INT],
  ['concierge.preRetrievalTimeoutMs', POSITIVE_INT],

  ['router.fallbackNegativeTtlSeconds', POSITIVE_INT],
  ['router.llmFallbackEnabled', z.boolean()],
  ['router.fallbackCacheTtlSeconds', POSITIVE_INT],
  ['ai.kie.timeoutMs', POSITIVE_INT],

  ['chat_presence_ttl_seconds', POSITIVE_INT],
  ['chat_outbox_sweep_stale_seconds', POSITIVE_INT],
  ['chat_outbox_sweep_batch_limit', POSITIVE_INT],
  ['chat_summary_min_messages', POSITIVE_INT],
  ['chat_summary_idle_days', POSITIVE_INT],
  ['external_link_ttl_hours', POSITIVE_INT],
  ['external_inbound_rate_limit', POSITIVE_INT],
  ['message_retention_days', NON_NEGATIVE_INT],
  ['hr_auto_subscribe_enabled', z.boolean()],
  ['huddle_max_participants', POSITIVE_INT],

  ['orchestrator.enabled', z.boolean()],
  ['orchestrator.maxSubagentsPerRun', POSITIVE_INT],
  ['orchestrator.runTimeoutMinutes', POSITIVE_INT],

  ['knowledge.axisClassifyEnabled', z.boolean()],
  ['roleProfiles.minBlocks', POSITIVE_INT],
  ['curation.completenessScannerEnabled', z.boolean()],
  ['tracker.goalAlignmentLowEnabled', z.boolean()],
  ['tracker.goalAlignmentLowPeriodDays', POSITIVE_INT],
  ['tracker.goalAlignmentLowMinIssues', POSITIVE_INT],
  ['tracker.goalAlignmentLowLowRatio', UNIT_INTERVAL],
  ['tracker.goalAlignmentLowDedupTtlSec', POSITIVE_INT],
  ['tracker.taskDedupGrayBand', UNIT_INTERVAL],
  ['tracker.intakeDedupThreshold', UNIT_INTERVAL],
  ['tracker.assigneeMatchMaxEdits', z.number().int().min(0).max(4)],
  ['tracker.progressAutoDraftEnabled', z.boolean()],
  ['tracker.progressAutoDraftMinSignals', z.number().int().min(1)],
  ['tracker.progressAutoDraftCron', z.string().min(1)],
  ['tracker.progressAutoDraftMinConfidence', UNIT_INTERVAL],
  ['tracker.progressAutoDraftRequireSubstantiveSignal', z.boolean()],
  ['tracker.activityDigestEnabled', z.boolean()],
  ['tracker.automationsEnabled', z.boolean()],
  ['tracker.recurrenceEnabled', z.boolean()],
  ['tracker.recurrenceCronCadence', z.string().min(1)],
  ['tracker.overdueNotifyEnabled', z.boolean()],
  ['tracker.assigneeClarifyEnabled', z.boolean()],
  ['tracker.dueDateClarifyEnabled', z.boolean()],
  ['tracker.assigneeProbePriorityHint', UNIT_INTERVAL],
  ['tracker.meetingTasksAlwaysPromote', z.boolean()],
  ['tracker.taskDedupLinkSemantics', z.enum(['link', 'delete'])],
  ['tracker.selfAssignAuthorFallbackEnabled', z.boolean()],
  ['tracker.taskExtractMinConfidence', UNIT_INTERVAL],
  ['tracker.taskDismissUndoWindowHours', POSITIVE_INT],
  ['tracker.completionDetailGateEnabled', z.boolean()],
  ['tracker.closureNotifyCreatorEnabled', z.boolean()],
  ['tracker.livingCardEnabled', z.boolean()],
  ['tracker.progressFromConversationMinConfidence', UNIT_INTERVAL],

  ['tracker.morningDigest.enabled', z.boolean()],
  ['tracker.morningDigest.hourMsk', z.number().int().min(0).max(23)],
  [
    'tracker.morningDigest.channels',
    z.array(z.enum(['in_app', 'email_smtp', 'telegram_bot', 'max_bot', 'push'])),
  ],
  ['tracker.morningDigest.maxItemsTotal', z.number().int().min(1).max(500)],
  ['tracker.morningDigest.sendWhenEmpty', z.boolean()],

  ['tracker.taskClarifySweep.enabled', z.boolean()],
  ['tracker.taskClarifySweep.hourMsk', z.number().int().min(0).max(23)],
  ['tracker.taskClarifySweep.minAgeHours', z.number().int().min(1).max(168)],
  ['tracker.methodCaptureEnabled', z.boolean()],
  ['tracker.methodCaptureMinComplexity', UNIT_INTERVAL],
  ['tracker.methodCapturePriorityHint', UNIT_INTERVAL],
  ['chatbox.analyze.stuckAnalyzingMin', POSITIVE_INT],

  ['taskClosure.enabled', z.boolean()],
  ['taskClosure.matchThreshold', UNIT_INTERVAL],
  ['taskClosure.embedTimeoutMs', POSITIVE_INT],
  ['taskClosure.embedMaxAttempts', POSITIVE_INT],
  ['taskClosure.candidateTtlDays', POSITIVE_INT],
  ['taskClosure.lexicalFallbackMinOverlap', UNIT_INTERVAL],

  ['taskSolution.buildHourMsk', z.number().int().min(0).max(23)],
  ['taskSolution.minSignalChars', NON_NEGATIVE_INT],
  ['taskSolution.lookbackHours', POSITIVE_INT],
  ['taskSolution.repeatThreshold', POSITIVE_INT],
  ['taskSolution.repeatSimilarity', UNIT_INTERVAL],

  ['conversational.telegramDigestHourLocal', z.number().int().min(0).max(23)],

  ['retention.defaultDays', POSITIVE_INT],
  ['retention.softDeleteGraceDays', POSITIVE_INT],
  ['retention.webhookDeliveryDays', POSITIVE_INT],
  ['retention.shareViewDays', POSITIVE_INT],
  ['retention.apiAccessLogDays', POSITIVE_INT],
  ['retention.sweepBatchSize', POSITIVE_INT],
  ['retention.rawEventsEnabled', z.boolean()],
  ['retention.auditEnabled', z.boolean()],
  ['retention.chatEnabled', z.boolean()],
  ['retention.blocksEnabled', z.boolean()],

  ['logging.dbLoggingEnabled', z.boolean()],
  ['logging.minLevel', z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])],
  ['logging.batchSize', z.number().int().min(1).max(1000)],
  ['logging.flushIntervalMs', z.number().int().min(500).max(600_000)],
  ['logging.maxBufferSize', z.number().int().min(100).max(100_000)],
  ['logging.retentionDays', z.number().int().min(1).max(3_650)],
  ['logging.logStackTraces', z.boolean()],
  ['logging.requestBodyLogging', z.boolean()],
  ['logging.responseBodyLogging', z.boolean()],
  ['logging.logSuccessfulRequests', z.boolean()],
  ['logging.slowRequestThresholdMs', z.number().int().min(0).max(600_000)],

  ['limits.clipMaxDurationSeconds', POSITIVE_INT],
  ['limits.exportZipMaxMeetings', POSITIVE_INT],
  ['limits.exportZipMaxBytes', POSITIVE_INT],
  ['limits.maxApiKeysPerUser', POSITIVE_INT],
  ['limits.maxWebhookSubscriptionsPerUser', POSITIVE_INT],
  ['limits.maxDestinationsPerUser', POSITIVE_INT],
  ['limits.maxTagsPerUser', POSITIVE_INT],
  ['limits.maxUserTemplatesPerUser', POSITIVE_INT],
  ['limits.maxChatRequestsPerDay', POSITIVE_INT],
  ['limits.maxChatTokensPerDay', POSITIVE_INT],
  ['limits.maxRenderJobsPerHour', POSITIVE_INT],
  ['limits.maxBulkExportsPerDay', POSITIVE_INT],
  ['limits.maxRegeneratePerMeetingPerDay', POSITIVE_INT],
  ['limits.maxMeetingsCreatedPerDayViaApi', POSITIVE_INT],
  ['limits.maxEmbeddingTokensPerMonthPerUser', POSITIVE_INT],
  ['limits.maxHighlightsPerMeeting', POSITIVE_INT],
  ['limits.maxBulkOperationIds', POSITIVE_INT],
  ['limits.maxChatMessageChars', POSITIVE_INT],
  ['limits.maxRoomMessageChars', POSITIVE_INT],
  ['limits.maxCardsPerUser', POSITIVE_INT],
  ['limits.maxCardRollupsPerDay', POSITIVE_INT],
  ['limits.maxGoalRecomputePerDay', POSITIVE_INT],
  ['limits.maxParticipantsPerMeeting', POSITIVE_INT],
  ['limits.maxMeetingDurationHours', POSITIVE_INT],

  ['share.tokenLengthBytes', POSITIVE_INT],
  ['share.defaultExpirationDays', POSITIVE_INT],
  ['share.allowedExpirationDays', z.array(POSITIVE_INT)],

  ['aiChatQuota.dailyLimitAdmin', POSITIVE_INT],
  ['aiChatQuota.dailyLimitMember', POSITIVE_INT],
  ['aiChatQuota.adminRoles', z.string().trim().min(1)],

  ['smartTables.maxRowsPerTable', POSITIVE_INT],
  ['smartTables.maxPropsPerTable', POSITIVE_INT],
  ['smartTables.maxTablesPerOrg', POSITIVE_INT],
  ['smartTables.maxCellSizeBytes', POSITIVE_INT],
  ['smartTables.importMaxFileMb', POSITIVE_INT],
  ['smartTables.importMaxRows', POSITIVE_INT],

  ['ai.anthropic.model', z.string().min(1)],
  ['ai.vox.model', z.string().min(1)],
  ['ai.deepseek.defaultModel', z.string().min(1)],
  ['ai.usageLog.previewMaxBytes', z.number().int().min(1024).max(1_048_576)],
  ['gepa.reflectionLm', z.string().min(1)],
  ['gepa.taskLm', z.string().min(1)],

  ['ai.mainReport.primary', z.enum(['minimax', 'deepseek'])],
  ['mail.dryRun', z.boolean()],
  ['operations.daily_digest.deliver_to_webpush', z.boolean()],
  ['operations.daily_digest.raw_char_budget', z.number().int().min(1000).max(500_000)],
  ['operations.weekly_digest.raw_char_budget', z.number().int().min(1000).max(500_000)],
  ['operations.digest.team_friction_min_confidence', UNIT_INTERVAL],
  ['operations.digest.team_friction_repeat_count', z.number().int().min(1).max(20)],
  ['operations.report_archive.recent_limit', z.number().int().min(1).max(50)],

  ['me.tasks.doneWindowDays', z.number().int().min(1).max(90)],
  ['operations.personal_day_narrative.enabled', z.boolean()],
  ['operations.personal_day_narrative.evening_hour', z.number().int().min(0).max(23)],
  ['operations.self_signals.plan_not_closing_streak_days', z.number().int().min(1).max(30)],
  ['knowledge.expertise.self_max_blocks_scanned', z.number().int().min(100).max(20_000)],
  ['knowledge.expertise.self_top_k', z.number().int().min(1).max(50)],

  ['betaOps.morningLocalHour', z.number().int().min(0).max(23)],
  ['betaOps.eveningLocalHour', z.number().int().min(0).max(23)],
  ['betaOps.weeklyDigestLocalHour', z.number().int().min(0).max(23)],
  ['betaOps.weeklyDigestLocalDay', z.number().int().min(0).max(6)],
  ['betaOps.monthlyDigestEnabled', z.boolean()],
  ['betaOps.monthlyDigestLocalHour', z.number().int().min(0).max(23)],
  ['betaOps.dailyDigestHourUtc', z.number().int().min(0).max(23)],

  ['dashboard.stuck.staleDaysThreshold', z.number().int().min(1).max(90)],

  ['recording.trackWatchdogEnabled', z.boolean()],
  ['recording.trackWatchdogTimeoutMinutes', z.coerce.number()],

  ['push_debounce_seconds', z.number().int().nonnegative()],
  ['unread_smart_badge', z.boolean()],
]);

export function getSchemaForKey(key: string): ZodTypeAny {
  return registry.get(key) ?? z.unknown();
}

export function hasSchemaForKey(key: string): boolean {
  return registry.has(key);
}

export function registeredSettingKeys(): string[] {
  return [...registry.keys()];
}

export interface SimpleJsonSchema {
  type: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'unknown';
  min?: number;
  max?: number;
  enumValues?: ReadonlyArray<string>;
}

interface CheckDef {
  check?: string;
  value?: unknown;
  inclusive?: boolean;
  format?: string;
}
interface ZodCheck {
  _zod?: { def?: CheckDef };
}
interface ZodDef {
  type?: string;
  checks?: ReadonlyArray<ZodCheck>;
  entries?: Record<string, string>;
  innerType?: ZodTypeAny;
  in?: ZodTypeAny;
  out?: ZodTypeAny;
}

function getDef(schema: ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def ?? {};
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    const def = getDef(current);
    if (def.type === 'optional' || def.type === 'default' || def.type === 'nullable') {
      const inner = def.innerType;
      if (!inner) break;
      current = inner;
      continue;
    }
    if (def.type === 'pipe') {
      const inner = def.out ?? def.in;
      if (!inner) break;
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

export function zodToSimpleSchema(schema: ZodTypeAny): SimpleJsonSchema {
  const unwrapped = unwrap(schema);
  const def = getDef(unwrapped);
  const type = def.type;

  if (type === 'number') {
    let isInt = false;
    let min: number | undefined;
    let max: number | undefined;
    for (const check of def.checks ?? []) {
      const cdef = check._zod?.def;
      if (!cdef) continue;
      if (cdef.check === 'number_format') {
        if (cdef.format === 'safeint' || cdef.format === 'int32' || cdef.format === 'int64') {
          isInt = true;
        }
      }
      if (cdef.check === 'greater_than' && typeof cdef.value === 'number') {
        const candidate = cdef.inclusive ? cdef.value : cdef.value;
        min = min === undefined ? candidate : Math.max(min, candidate);
      }
      if (cdef.check === 'less_than' && typeof cdef.value === 'number') {
        const candidate = cdef.value;
        max = max === undefined ? candidate : Math.min(max, candidate);
      }
    }
    const out: SimpleJsonSchema = { type: isInt ? 'integer' : 'number' };
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    return out;
  }

  if (type === 'boolean') {
    return { type: 'boolean' };
  }

  if (type === 'string') {
    return { type: 'string' };
  }

  if (type === 'enum') {
    const values = def.entries ? Object.values(def.entries) : [];
    return {
      type: 'enum',
      enumValues: values,
    };
  }

  return { type: 'unknown' };
}
