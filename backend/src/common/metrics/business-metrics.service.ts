import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, register } from 'prom-client';

@Injectable()
export class BusinessMetricsService implements OnModuleInit {
  private meetingsCreatedTotal!: Counter<'type'>;
  private meetingsFinishedTotal!: Counter<'type'>;
  private meetingsFailedTotal!: Counter<'stage'>;

  private aiPipelineDurationSeconds!: Histogram<'stage' | 'type' | 'model'>;
  private aiCostUsdTotal!: Counter<string>;

  private recordingsBytesTotal!: Counter<string>;
  private recordingsDeletedTotal!: Counter<'reason'>;
  private recordingsFailedTotal!: Counter<'reason'>;
  private recordingTrackEgressFailedTotal!: Counter<'reason'>;

  private crossmarkApiRequestsTotal!: Counter<'endpoint' | 'status'>;
  private livekitWebhookEventsTotal!: Counter<'type'>;
  private livekitEgressEndedGapSeconds!: Histogram<'request_type'>;

  private llmFallbackTotal!: Counter<'provider'>;

  private llmRouterDispatchTotal!: Counter<'task_type' | 'provider' | 'status'>;

  private coreLlmNoProviderTotal!: Counter<'task_type'>;

  private llmCostUnpricedTotal!: Counter<'provider' | 'model'>;

  private kcBlockLinkerFallbackNoneTotal!: Counter<'reason'>;
  private kcBlockLinkerInvalidJsonTotal!: Counter<'reason'>;

  private kcEntityGraphInvalidJsonTotal!: Counter<'reason'>;
  private kcEntityGraphFallbackNoneTotal!: Counter<'reason'>;

  private taskDedupeTotal!: Counter<'result'>;

  private chatboxSyncsTotal!: Counter<'scope' | 'status'>;
  private chatboxAnalyzesTotal!: Counter<'status'>;
  private chatboxPendingSessions!: Gauge<string>;
  private chatboxLastSyncTsSeconds!: Gauge<'scope'>;

  private llmCacheHitTotal!: Counter<'provider' | 'model' | 'task_type'>;
  private llmCacheReadTokensTotal!: Counter<'provider' | 'model'>;
  private llmCacheCreationTokensTotal!: Counter<'provider' | 'model'>;
  private llmCallsTotal!: Counter<'provider'>;
  private llmCacheHitRatioBelowThreshold!: Gauge<'provider'>;

  private deepseekSchemaToToolConversionTotal!: Counter<'model'>;

  private llmThinkingModelGuardTotal!: Counter<'kind' | 'model'>;

  private adminAiModelsRouteChangeTotal!: Counter<'task_type' | 'change_type'>;
  private adminAiModelsExperimentStartedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentStoppedTotal!: Counter<'task_type'>;
  private adminAiModelsExperimentCompletedTotal!: Counter<'task_type'>;

  private promptResolverTotal!: Counter<'source'>;
  private promptResolverFallbackTotal!: Counter<'reason'>;

  private promptInjectionAttemptTotal!: Counter<'source' | 'pattern'>;

  private promptInvalidResponseTotal!: Counter<'task_type' | 'model' | 'reason'>;

  private queryPlanExtractionTotal!: Counter<'result'>;
  private queryPlanRetrievalFilteredTotal!: Counter<'filtered'>;
  private queryPlanEmptyPoolTotal!: Counter<'result'>;

  private taskAssigneeAmbiguousTotal!: Counter<'tenant' | 'reason'>;

  private promptTemplateActiveCount!: Gauge<'scope'>;
  private promptTemplatePreviewTotal!: Counter<'result'>;

  private promptExperimentActiveCount!: Gauge<string>;
  private promptExperimentCompletedTotal!: Counter<'reason'>;
  private promptTemplateFeedbackTotal!: Counter<'reaction'>;

  private embeddingTokensTotal!: Counter<'provider' | 'status'>;
  private embeddingChunksTotal!: Counter<'status'>;

  private mp4RenderDurationSeconds!: Histogram<'status'>;

  private webhookDeliveryTotal!: Counter<'event' | 'status'>;
  private quotaExceededTotal!: Counter<'quota_name'>;
  private exportCompletedTotal!: Counter<'type' | 'status'>;
  private chatRequestTotal!: Counter<'scope'>;

  private cardsTotal!: Counter<'kind' | 'action'>;
  private cardRollupRunsTotal!: Counter<'status'>;

  private coreBlocksTotal!: Gauge<'tenant' | 'status'>;
  private coreEntitiesTotal!: Gauge<'tenant' | 'type'>;
  private coreLinksTotal!: Gauge<'tenant' | 'relation_type'>;
  private coreRawEventsTotal!: Gauge<'tenant' | 'processing_status'>;
  private kcFactsOpenGauge!: Gauge<'tenant' | 'signal_type'>;
  private corePipelineDurationSeconds!: Histogram<'worker'>;
  private coreLlmTokensTotal!: Counter<'tenant' | 'task_type'>;
  private coreRetentionDeletedTotal!: Counter<'kind'>;
  private corePersonalDataErasuresTotal!: Counter<string>;
  private coreDataClassViolationsTotal!: Counter<'task_type' | 'attempted_class'>;
  private llmBudgetExceededTotal!: Counter<'mode'>;

  private extractionEntitiesTotal!: Counter<'type'>;
  private extractionConfidence!: Histogram<'type'>;
  private extractionAmbiguousTotal!: Counter<'type'>;
  private entityResolutionDedupTotal!: Counter<'type' | 'action'>;

  private behaviorMetricsComputedTotal!: Counter<string>;
  private behaviorMetricsFailedTotal!: Counter<string>;
  private behaviorMetricsLowConfidenceTotal!: Counter<string>;
  private behaviorMetricsDurationSeconds!: Histogram<string>;
  private behaviorMetricsLlmRefineTotal!: Counter<'status'>;

  private qualityScoreComputedTotal!: Counter<string>;
  private qualityScoreFailedTotal!: Counter<string>;
  private qualityScoreDisabledTotal!: Counter<'reason'>;
  private qualityScoreRegenerateTotal!: Counter<string>;
  private qualityScoreAvg!: Gauge<'org_id'>;
  private qualityScoreLlmCostUsd!: Counter<string>;

  private transcriptCleaningCompletedTotal!: Counter<string>;
  private transcriptCleaningFailedTotal!: Counter<string>;
  private transcriptCleaningDurationSeconds!: Histogram<string>;
  private transcriptCleaningCharsReduced!: Histogram<string>;
  private transcriptCleaningLlmCostUsdTotal!: Counter<string>;

  private meetingReportCreatedTotal!: Counter<'kind'>;
  private meetingReportGeneratedTotal!: Counter<string>;
  private meetingReportFailedTotal!: Counter<'reason'>;
  private meetingReportRegeneratedTotal!: Counter<string>;
  private meetingReportDeletedTotal!: Counter<string>;
  private meetingReportDurationSeconds!: Histogram<string>;
  private meetingReportLlmCostUsd!: Counter<string>;

  private meetingReportFastTotal!: Counter<'tenant' | 'status'>;
  private meetingReportFastDurationSeconds!: Histogram<string>;

  private conversationalNotificationsTotal!: Counter<'event_type' | 'status'>;
  private conversationalDeliveriesTotal!: Counter<'kind' | 'status'>;
  private conversationalInboundTotal!: Counter<'kind' | 'type'>;
  private conversationalLinkAttemptsTotal!: Counter<'kind' | 'status'>;
  private conversationalResponseTimeSeconds!: Histogram<'kind' | 'event_type'>;

  private notificationBudgetConsumedTotal!: Counter<'trigger'>;
  private notificationBudgetBlockedTotal!: Counter<'reason'>;
  private notificationDeferredToDigestTotal!: Counter<string>;
  private channelBindingCoverageRatio!: Gauge<'tenant_top'>;
  private channelBindingCampaignInvitedTotal!: Counter<'tenant_top'>;
  private checkinPromptDeliveredTotal!: Counter<'channel'>;

  private customerRiskSnapshotsTotal!: Counter<'level'>;
  private customerRiskRadarFailedTotal!: Counter<'reason'>;
  private customerRiskManagerNotifiedTotal!: Counter<string>;

  private portfolioHealthScore!: Gauge<'tenant_top'>;
  private portfolioHealthSnapshotTotal!: Counter<'tenant_top'>;
  private portfolioPrioritySetTotal!: Counter<'tenant_top' | 'priority'>;

  private personalDailyBriefBuiltTotal!: Counter<string>;
  private personalDailyBriefDeliveredTotal!: Counter<'channel'>;
  private personalDailyBriefOpenedTotal!: Counter<string>;
  private knowsWhoMatchTotal!: Counter<'found'>;
  private execMorningPushDeliveredTotal!: Counter<'channel'>;

  private blockerSynthesisRecurringTotal!: Counter<'status'>;
  private decisionStalledTotal!: Counter<string>;
  private decisionThroughputPercent!: Gauge<'tenant_top'>;
  private promiseCascadeAlertTotal!: Counter<string>;
  private themeSilenceSurfacedTotal!: Counter<'severity'>;
  private decisionAutoImplementedTotal!: Counter<string>;

  private ideasTopServedTotal!: Counter<string>;
  private ideaStatusAutoAdvancedTotal!: Counter<'to'>;
  private ideaStatusChangedNotifiedTotal!: Counter<string>;
  private insightRecheckedTotal!: Counter<'reactivated'>;
  private knowledgeAtRiskTotal!: Counter<'severity'>;
  private teamCapacityOverloadTotal!: Counter<string>;
  private onboardingRampStalledTotal!: Counter<string>;

  private valueRecapBuiltTotal!: Counter<string>;
  private valueRecapDeliveredTotal!: Counter<'channel'>;
  private valueRecapOpenedTotal!: Counter<string>;
  private chatV2FeedbackTotal!: Counter<'reaction'>;
  private chatV2AnsweredWithCitation!: Gauge<'mode'>;

  private telegramBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private telegramBotWebhookReceivedTotal!: Counter<'type'>;

  private telegramProxyRequestTotal!: Counter<'api_method' | 'outcome'>;
  private telegramProxyRequestDurationSeconds!: Histogram<'api_method'>;
  private telegramProxyHealthCheckTotal!: Counter<'outcome'>;

  private telegramBotGlobalWebhookReceivedTotal!: Counter<'type'>;
  private telegramBotUnknownSenderTotal!: Counter<'reason'>;
  private botLoginCommandTotal!: Counter<'outcome'>;

  private adminTelegramBotActionsTotal!: Counter<'action'>;

  private inviteCreatedTotal!: Counter<'has_email'>;
  private inviteAcceptedTotal!: Counter<'path'>;
  private inviteReminderSentTotal!: Counter<'day'>;
  private inviteExpiredTotal!: Counter<string>;
  private magicLinkRequestTotal!: Counter<'outcome'>;
  private magicLinkConsumeTotal!: Counter<'outcome'>;
  private mustChangePasswordBlockTotal!: Counter<'path'>;
  private tochkaWebhookReplayTotal!: Counter<'reason'>;
  private referralSelfReferralDeniedTotal!: Counter<string>;
  private referralInnMismatchTotal!: Counter<'reason'>;
  private referralAttributionFirstTouchLockedTotal!: Counter<string>;
  private participantRenamedTotal!: Counter<string>;
  private billingInvoiceCreatedTotal!: Counter<'tenant_top' | 'kind'>;
  private billingInvoicePaidTotal!: Counter<'tenant_top' | 'kind'>;
  private billingSubscriptionRenewedTotal!: Counter<'tenant_top' | 'tier'>;
  private billingSubscriptionCancelledTotal!: Counter<'tenant_top' | 'reason'>;
  private billingWebhookReceivedTotal!: Counter<'provider' | 'status'>;
  private billingProviderRequestDurationSeconds!: Histogram<'provider' | 'method' | 'status'>;
  private referralClickTotal!: Counter<'partner_top'>;
  private referralSignupTotal!: Counter<'partner_top'>;
  private referralPayoutCreatedTotal!: Counter<'cron_run_date'>;
  private referralPayoutAmountRubTotal!: Counter<string>;
  private referralPromoImpressionTotal!: Counter<'role'>;
  private referralPromoClickTotal!: Counter<'role'>;
  private referralPromoDismissedTotal!: Counter<'role'>;
  private billingEmitFailedTotal!: Counter<'event'>;
  private conciergeConfigErrorTotal!: Counter<'reason'>;

  private maxBotApiErrorsTotal!: Counter<'api_method' | 'code'>;
  private maxBotWebhookReceivedTotal!: Counter<'type'>;

  private botInboundTotal!: Counter<'channel' | 'kind'>;
  private botVoiceAsrDurationSeconds!: Histogram<'channel'>;
  private botIntentClassifiedTotal!: Counter<'channel' | 'intent' | 'source'>;
  private botCheckinIntentClassifierTotal!: Counter<'channel' | 'kind' | 'source'>;
  private botDailyCheckinSelfTotal!: Counter<'channel' | 'kind' | 'outcome'>;

  private telegramTasksCreatedTotal!: Counter<'tenant_top' | 'status'>;
  private telegramVoiceTranscribedTotal!: Counter<'tenant_top' | 'kind'>;
  private telegramForwardsTotal!: Counter<'tenant_top' | 'status'>;
  private telegramDigestSentTotal!: Counter<'tenant_top' | 'result'>;
  private telegramReplyClassifiedTotal!: Counter<'tenant_top' | 'kind'>;
  private pendingReminderSentTotal!: Counter<'tenant_top' | 'result'>;

  private coreRouterDispatchedTotal!: Counter<'specialist' | 'signal_type'>;
  private coreRouterFanOut!: Histogram<string>;
  private coreRouterTrimmedTotal!: Counter<'signal_type'>;

  private curationItemsTotal!: Counter<'resource_type' | 'level' | 'status'>;
  private curationDecisionTotal!: Counter<'decision_type' | 'level'>;
  private curationTimeToDecideSeconds!: Histogram<'level'>;
  private curationAutoCanonicalTotal!: Counter<'resource_type'>;
  private curationConflictsTotal!: Counter<'relation_type' | 'resolution'>;
  private curationStaleDetectedTotal!: Counter<'resource_type'>;
  private curationItemExpiredTotal!: Counter<'resource_type'>;
  private curationItemAgeSeconds!: Histogram<'level'>;
  private curationProvisionalTotal!: Counter<'resource_type'>;
  private curationAuditSampleTotal!: Counter<'resource_type'>;
  private curationVerifierVerdictTotal!: Counter<'decision' | 'consensus_type'>;
  private conflictArbiterTotal!: Counter<'verdict' | 'outcome'>;
  private curationKillSwitchTotal!: Counter<'resource_type'>;
  private curationAutotuneAdjustmentTotal!: Counter<'resource_type' | 'direction'>;
  private completenessSlotsOpenTotal!: Gauge<'card_type'>;
  private completenessSlotsFilledTotal!: Counter<'card_type'>;
  private consistencyViolationsTotal!: Counter<'rule'>;
  private consistencyCheckerDurationSeconds!: Histogram<never>;

  private coreSpecialistCardsTotal!: Gauge<'type' | 'status'>;
  private coreSpecialistPipelineDurationSeconds!: Histogram<'type'>;
  private coreSpecialistLlmTokensTotal!: Counter<'type' | 'model' | 'tier'>;
  private coreSpecialistProbeEventsTotal!: Counter<'type' | 'reason'>;
  private coreSpecialistConflictEventsTotal!: Counter<'type'>;
  private coreSpecialistExtractionFailuresTotal!: Counter<'type' | 'reason'>;
  private coreSpecialistSkippedTotal!: Counter<'specialist' | 'reason'>;
  private kcTypedEntityFailedTotal!: Counter<'type' | 'reason'>;
  private kcSubjectAttributionTotal!: Counter<'via'>;
  private kcAccessShadowDiffTotal!: Counter<'surface'>;
  private kcAccessDeniedTotal!: Counter<'surface'>;
  private kcMaterializationGapTotal!: Counter<'type'>;
  private goalThemeAutolinkTotal!: Counter<'method'>;
  private goalTaskLinkTotal!: Counter<'result'>;
  private meetingIngestFailedTotal!: Counter<'reason'>;
  private coreSpecialistConflictEvolvingTotal!: Counter<'type'>;
  private decisionSupersedeChainLength!: Histogram<never>;

  private goalKrAutoprogressTotal!: Counter<'source_kind' | 'status'>;

  private goalsPulseGeneratedTotal!: Counter<'tenant_top'>;
  private goalsPulseFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private goalsPulseDeliveredTotal!: Counter<'tenant_top' | 'channel'>;

  private temporalEdgesInvalidatedTotal!: Counter<'relationType'>;
  private temporalFilterHitsTotal!: Counter<'result'>;
  private edgesWithTemporalTotal!: Gauge<'type'>;

  private debateJudgmentsTotal!: Counter<'task_type' | 'decision' | 'consensus_type'>;
  private debateCostUsdTotal!: Counter<'tenant_top' | 'task_type'>;
  private debateRound2TriggeredTotal!: Counter<'task_type'>;
  private debateProviderDisagreementTotal!: Counter<'provider_a' | 'provider_b' | 'task_type'>;
  private debateFallbackToSingleTotal!: Counter<'reason'>;

  private kcFactSupersedeVerdictsTotal!: Counter<'verdict'>;
  private kcFactSupersedeLatencyMs!: Histogram<never>;

  private kcEntityResolvePathTotal!: Counter<'path'>;
  private kcEntityResolveLatencyMs!: Histogram<never>;

  private kcProjectionRebuildTotal!: Counter<'type'>;
  private kcProjectionRebuildLagMs!: Histogram<never>;

  private knowledgeCloneCategoriesPerProfile!: Histogram<never>;
  private knowledgeCloneProfileSizeKb!: Histogram<never>;

  private processTemplatesTotal!: Gauge<'tenant_top' | 'status'>;
  private processTemplateCompletenessAvg!: Gauge<'tenant_top'>;
  private processDetectorExtractionsTotal!: Counter<'tenant_top' | 'result'>;
  private processTemplateExtractDurationSeconds!: Histogram<never>;

  private crossFunctionalProcessesTotal!: Gauge<'tenant_top'>;
  private crossFunctionalFrictionActiveTotal!: Gauge<'tenant_top' | 'severity'>;
  private crossFunctionalFrictionResolutionTimeSeconds!: Histogram<'tenant_top'>;

  private insightsDynamicLabelCount!: Gauge<'label'>;

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
  private probeResponseClassifiedTotal!: Counter<'confidence_bucket'>;
  private probeResponseUnclearTotal!: Counter<'original_reason'>;
  private probeOutcomeTotal!: Counter<'outcome' | 'reason'>;
  private ownerResolutionTotal!: Counter<'outcome'>;
  private assistantTurnTotal!: Counter<'outcome'>;
  private promptFeedbackTotal!: Counter<'prompt_key' | 'has_edit'>;
  private autoruleExtractedTotal!: Counter<'prompt_key' | 'rule_type'>;
  private autoruleRulesTotal!: Gauge<'prompt_key' | 'status' | 'source'>;
  private autoruleOverriddenTotal!: Counter<'prompt_key'>;
  private conciergePrmAgreementTotal!: Counter<'agreed'>;
  private conciergePrmLlmChoseRankTotal!: Counter<'rank'>;
  private conciergePrmCostUsdTotal!: Counter<'tenant_top'>;
  private conciergePrmScoreDistribution!: Histogram<'tool_name'>;
  private practiceSkillsTotal!: Gauge<'tenant_top' | 'scope' | 'status'>;
  private practiceSkillsExtractedTotal!: Counter<'scope'>;
  private practiceSkillsPromotedTotal!: Counter<never>;
  private practiceSkillsArchivedTotal!: Counter<never>;
  private practiceSkillsRunsTotal!: Counter<'status'>;
  private practiceSkillsCompositeVsBaseline!: Histogram<never>;
  private practiceSkillsRetrievalHitTotal!: Counter<'scope'>;
  private gepaOptimizationsTotal!: Counter<'prompt_key' | 'status'>;
  private gepaCandidatesTotal!: Gauge<'prompt_key' | 'status'>;
  private gepaPromotedTotal!: Counter<'prompt_key'>;
  private gepaRejectedTotal!: Counter<'reason'>;
  private gepaAbActiveTotal!: Gauge<never>;
  private gepaCostUsdTotal!: Counter<'tenant_top'>;
  private gepaRollbackTotal!: Counter<'reason'>;
  private ideaStatusChangeNotificationsTotal!: Counter<'new_status'>;

  private chatV2QueriesTotal!: Counter<'mode' | 'channel_origin'>;
  private chatV2RetrievalBlocks!: Histogram<'mode'>;
  private chatV2SynthesisDurationSeconds!: Histogram<'mode'>;
  private chatV2NoEvidenceTotal!: Counter<'mode'>;
  private chatV2UncertaintyMarkedTotal!: Counter<'mode'>;
  private chatV2ConversationsArchivedTotal!: Counter<'reason'>;
  private chatV2ReasoningChainsAttachedTotal!: Counter<'depth'>;
  private chatV2ContradictingBlocksInContext!: Histogram<string>;

  private answerCacheHitTotal!: Counter<'tenant_top'>;
  private retrievalCacheHitTotal!: Counter<'tenant_top'>;
  private dialogProcessingDurationSeconds!: Histogram<'step'>;
  private conversationSummaryTotal!: Counter<'tenant_top'>;
  private dialogConfidenceLowTotal!: Counter<'tenant_top'>;

  private skillProfilesActiveTotal!: Gauge<never>;
  private skillTraitsPerProfile!: Histogram<never>;
  private skillTraitsMarkedMisleadingTotal!: Counter<'category'>;
  private personaActiveTotal!: Gauge<'scope'>;
  private personaBuildDurationSeconds!: Histogram<never>;
  private cloneAskTotal!: Counter<'scope'>;
  private cloneAskByOwnerTotal!: Counter<never>;
  private cloneAskRefusedTotal!: Counter<'reason'>;
  private skillCategoriesTotal!: Gauge<'tenant_top'>;
  private skillTraitCategorizedRatio!: Gauge<'tenant_top'>;
  private executablePersonaSnapshotsTotal!: Counter<'tenant_top' | 'trigger'>;
  private executablePersonaSnapshotLagSeconds!: Gauge<'tenant_top'>;
  private personaRebuildTriggeredTotal!: Counter<'reason'>;
  private skillTraitConceptsTotal!: Gauge<'status'>;
  private skillTraitConceptsMergedTotal!: Counter<never>;
  private cloneRoleVersionCreatedTotal!: Counter<'role_id'>;
  private cloneRoleVersionsTotal!: Gauge<'role_id'>;
  private rolePrinciplesSynthesizedTotal!: Counter<'outcome'>;
  private rolePrinciplesActiveTotal!: Gauge<never>;
  private clonePersonaLayerScore!: Histogram<'variant'>;
  private personaLayerValidationCasesTotal!: Counter<'outcome'>;

  private axisLabelsTotal!: Counter<'tenant_top' | 'axis' | 'source'>;
  private routerFallbackCallsTotal!: Counter<'tenant_top' | 'result'>;
  private routerFallbackCacheHitTotal!: Counter<'tenant_top'>;
  private axisClassifyDurationSeconds!: Histogram<'axis'>;

  private maturityScoreAvg!: Gauge<'tenant_top' | 'scope'>;
  private domainsTotal!: Gauge<'tenant_top'>;
  private departmentsTotal!: Gauge<'tenant_top'>;
  private companyProfileCompleteness!: Gauge<'tenant_top'>;
  private domainExpanderCreatedTotal!: Counter<'tenant_top'>;
  private maturityScorerDurationSeconds!: Histogram<'scope'>;

  private appointmentsTotal!: Gauge<'tenant_top' | 'status'>;
  private kpiMeasurementsTotal!: Counter<'tenant_top'>;
  private kpiOverdueMeasurementsTotal!: Gauge<'tenant_top' | 'frequency'>;
  private personRoleToAppointmentMigrationProgress!: Gauge<'tenant_top'>;

  private brandVoiceProfileCompleteness!: Gauge<'tenant_top'>;
  private brandVoiceExtractorRunsTotal!: Counter<'tenant_top' | 'result'>;
  private brandVoiceCorpusSize!: Gauge<'tenant_top'>;

  private experimentsTotal!: Gauge<'tenant_top' | 'status'>;
  private experimentsRunningDurationDays!: Histogram<'tenant_top'>;
  private experimentsLessonsExtractedTotal!: Counter<'tenant_top'>;
  private experimentDetectorRunsTotal!: Counter<'tenant_top' | 'result'>;

  private roleMapCompletenessAvg!: Gauge<'tenant_top'>;
  private roleMapBuilderRunsTotal!: Counter<'tenant_top' | 'result'>;
  private roleMapExtractDurationSeconds!: Histogram<never>;
  private rolesWithNormalizedDataRatio!: Gauge<'tenant_top'>;

  private voiceAsrRequestsTotal!: Counter<'tenant_top' | 'provider'>;
  private voiceAsrDurationSeconds!: Histogram<'provider'>;
  private voiceTtsRequestsTotal!: Counter<'tenant_top' | 'provider'>;
  private voiceTtsCharsTotal!: Counter<'tenant_top'>;

  private voiceWsSessionTotal!: Counter<'outcome'>;
  private voiceWsChunkTotal!: Counter<never>;
  private voiceWsAsrLatencyMs!: Histogram<never>;

  private dailyCheckinsCompletedTotal!: Counter<'tenant_top' | 'kind'>;
  private dailyCheckinsSkippedTotal!: Counter<'tenant_top' | 'kind' | 'reason'>;
  private operationsBlockersTotal!: Gauge<'tenant_top' | 'severity'>;
  private teamFrictionsTotal!: Gauge<'tenant_top'>;
  private goalCascadeMissesTotal!: Counter<'tenant_top'>;
  private personalRelationBuilderRunsTotal!: Counter<'tenant_top' | 'result'>;

  private dashboardValueStripServedTotal!: Counter<'tenant_top'>;
  private dashboardMainFirstScreenWidgetCount!: Gauge<'tenant_top'>;

  private weeklyPerPersonSelfViewServedTotal!: Counter<'tenant_top'>;
  private weeklyPerPersonNoAnswerTotal!: Counter<'tenant_top'>;

  private myIdeasFateServedTotal!: Counter<'tenant_top'>;
  private myRecognitionsServedTotal!: Counter<'tenant_top'>;

  private cooSentimentAnalyzedTotal!: Counter<'tenant_top' | 'sentiment'>;
  private cooSentimentFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private checkinGraphIngestTotal!: Counter<'result'>;
  private cooWeeklyDigestGeneratedTotal!: Counter<'tenant_top'>;
  private cooWeeklyDigestFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private cooTeamTemperatureRedShare!: Gauge<'tenant_top'>;
  private cooBlockersResolvedTotal!: Gauge<'tenant_top'>;
  private cooTeamCapacityWidgetServedTotal!: Counter<'tenant_top'>;

  private cooDailyDigestGeneratedTotal!: Counter<'tenant_top'>;
  private cooDailyDigestFailedTotal!: Counter<'tenant_top' | 'reason'>;
  private cooDailyDigestDeliveredTotal!: Counter<'tenant_top' | 'channel'>;
  private cooDailyDigestAgeSeconds!: Gauge<'tenant_top'>;

  private commitmentAuthorCoverageRatio!: Gauge<'tenant_top'>;
  private probeSuggestedTotal!: Counter<'trigger'>;

  private cooInsightsByCauseTotal!: Gauge<'tenant_top' | 'cause'>;
  private cooCompanyMaturityScore!: Gauge<'tenant_top'>;

  private commitmentsOpenTotal!: Gauge<'tenant_top'>;
  private commitmentsAskedTotal!: Counter<'tenant_top'>;
  private commitmentsFulfilledTotal!: Counter<'tenant_top'>;
  private commitmentsMissedTotal!: Counter<'tenant_top'>;
  private commitmentsEscalatedTotal!: Counter<'tenant_top'>;
  private commitmentsExtractFailedTotal!: Counter<'tenant_top' | 'reason'>;

  private conciergeMessagesTotal!: Counter<'tenant_top'>;
  private conciergeToolCallsTotal!: Counter<'tenant_top' | 'tool' | 'status'>;
  private conciergeUndoTotal!: Counter<'tenant_top' | 'tool'>;
  private conciergeQuotaExceededTotal!: Counter<'tenant_top' | 'scope'>;
  private conciergeDialogLayerUsedTotal!: Counter<'intent'>;
  private conciergeCacheHitTotal!: Counter<string>;
  private conciergePreRetrievalHitsCount!: Histogram<string>;

  private orchestratorRunsTotal!: Counter<'status'>;
  private orchestratorSubagentsTotal!: Counter<'agent_type' | 'result'>;
  private orchestratorRunDurationSeconds!: Histogram<never>;
  private orchestratorVerificationLowConfidenceTotal!: Counter<never>;

  private proactiveNotificationsEmittedTotal!: Counter<'rule' | 'severity'>;
  private proactiveNotificationsDismissedTotal!: Counter<'rule'>;
  private proactiveNotificationsDedupSkippedTotal!: Counter<never>;
  private proactiveWatcherDurationSeconds!: Histogram<'rule'>;

  private aiCostUsdLabeledTotal!: Counter<'tenant_top' | 'task_type' | 'provider' | 'model'>;
  private aiCostRubLabeledTotal!: Counter<'tenant_top' | 'task_type' | 'provider' | 'model'>;
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

  private issuesCreatedTotal!: Counter<'tenant' | 'project' | 'source'>;
  private issuesCompletedTotal!: Counter<'tenant' | 'project'>;
  private subtasksCreatedTotal!: Counter<'tenant' | 'project'>;
  private intakeTriagedTotal!: Counter<'tenant' | 'decision'>;
  private trackerWebhookDeliveryTotal!: Counter<'tenant' | 'event' | 'success'>;
  private trackerWebhookRetryCount!: Counter<'tenant' | 'webhook_id'>;
  private trackerEventsToKnowledgeCoreTotal!: Counter<'tenant' | 'type'>;
  private trackerIssueEmbedTotal!: Counter<'tenant_top' | 'status'>;
  private trackerIssueSimilarSearchTotal!: Counter<'tenant_top'>;
  private checklistsCreatedTotal!: Counter<'tenant' | 'project'>;
  private checklistItemsAddedTotal!: Counter<'tenant' | 'project' | 'via_bulk'>;
  private checklistItemsCompletedTotal!: Counter<'tenant' | 'project'>;
  private projectDocumentsCreatedTotal!: Counter<'tenant' | 'project'>;
  private projectDocumentsUpdatedTotal!: Counter<'tenant' | 'project'>;
  private linkedCardsViewTotal!: Counter<'tenant' | 'project'>;
  private aiIssueInferredTotal!: Counter<'tenant_top' | 'accepted'>;
  private aiIssueGoalSuggestedTotal!: Counter<'tenant_top' | 'accepted' | 'source'>;
  private aiMeetingActionsExtractedTotal!: Counter<'tenant_top' | 'status'>;
  private aiIntakeAutoAcceptedTotal!: Counter<'tenant_top' | 'source' | 'via_default_project'>;
  private aiIntakeSuggestedTotal!: Counter<'tenant_top' | 'status' | 'source'>;
  private importStartedTotal!: Counter<'tenant_top' | 'source'>;
  private importCompletedTotal!: Counter<'tenant_top' | 'source' | 'success'>;
  private importIssuesProcessedTotal!: Counter<'tenant_top' | 'source'>;
  private issuesByStateCount!: Gauge<'tenant' | 'project' | 'state'>;
  private issuesOverdueCount!: Gauge<'tenant' | 'project'>;
  private intakePendingCount!: Gauge<'tenant'>;
  private teamTemplateUsedTotal!: Counter<'tenant_top' | 'slug'>;
  private holidayDueDateAdjustedTotal!: Counter<'tenant_top'>;
  private boardsCreatedTotal!: Counter<'tenant_top' | 'project'>;
  private boardsArchivedTotal!: Counter<'tenant_top' | 'project'>;
  private boardIssuesMovedTotal!: Counter<'tenant_top' | 'from_board' | 'to_board'>;
  private issueMovedToProjectTotal!: Counter<'tenant_top'>;
  private mailInboundReceivedTotal!: Counter<'project_id' | 'status'>;
  private mailInboundIssuesCreatedTotal!: Counter<string>;
  private mailInboundBounceTotal!: Counter<'reason'>;
  private mailInboundAttachmentUploadedTotal!: Counter<string>;
  private probeGoalAlignmentLowEmittedTotal!: Counter<'tenant_top'>;

  private feedItemsEmittedTotal!: Counter<'tenant' | 'feed_type' | 'severity'>;
  private feedItemsActionedTotal!: Counter<'tenant' | 'feed_type' | 'status'>;
  private feedReactionsTotal!: Counter<'tenant' | 'feed_type' | 'reaction'>;
  private feedItemsExpiredTotal!: Counter<'tenant' | 'feed_type'>;

  private calendarEventsCreatedTotal!: Counter<'tenant' | 'kind' | 'visibility'>;
  private calendarRemindersSentTotal!: Counter<'tenant' | 'channel' | 'success'>;
  private calendarFindFreeSlotTotal!: Counter<'tenant' | 'found'>;

  private feedbackDigestRunsTotal!: Counter<'result'>;
  private feedbackDigestMessagesProcessedTotal!: Counter<never>;
  private feedbackDigestNewTopicsTotal!: Counter<never>;
  private feedbackDigestFailedRunsTotal!: Counter<never>;

  private tourStartedTotal!: Counter<'tenant' | 'tour_id'>;
  private tourCompletedTotal!: Counter<'tenant' | 'tour_id'>;
  private tourSkippedTotal!: Counter<'tenant' | 'tour_id' | 'at_step'>;

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

    this.taskDedupeTotal = this.getOrCreateCounter({
      name: 'z_task_dedupe_total',
      help: 'Ф5 Р2 — семантический дедуп задач встречи. result=knn_merged|llm_merged|kept|skipped.',
      labelNames: ['result'] as const,
    });

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
    this.chatboxPendingSessions = this.getOrCreateGauge({
      name: 'z_chatbox_pending_sessions',
      help: 'Ф3 — сколько закрытых сессий чата ждут анализа (analysisStatus=pending, по всем org). Растёт и не убывает → анализ встал.',
    });
    this.chatboxLastSyncTsSeconds = this.getOrCreateGauge({
      name: 'z_chatbox_last_sync_ts_seconds',
      help: 'Ф3 — unixtime последнего успешного синка ChatBox per scope. time()-max(...)>7200 → синк отстал.',
      labelNames: ['scope'] as const,
    });

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
    this.kcFactsOpenGauge = this.getOrCreateGauge({
      name: 'kc_facts_open_gauge',
      help: "Открытые (validUntil IS NULL) канонические IdeaBlock'и по signal_type. KC-Temporal W1.1.",
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

    this.meetingReportFastTotal = this.getOrCreateCounter({
      name: 'z_meeting_report_fast_total',
      help: 'meeting-report-fast: количество запусков воркера по tenant × status (ready|failed|partial).',
      labelNames: ['tenant', 'status'] as const,
    });
    this.meetingReportFastDurationSeconds = this.getOrCreateHistogram({
      name: 'z_meeting_report_fast_duration_seconds',
      help: 'meeting-report-fast: длительность одного запуска воркера (секунды). p50/p95 через histogram_quantile.',
      labelNames: [] as const,
      buckets: [5, 15, 30, 60, 90, 120, 180, 300, 600],
    });

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

    this.execMorningPushDeliveredTotal = this.getOrCreateCounter({
      name: 'z_exec_morning_push_delivered_total',
      help: 'B6/Ф7 — поставлен в очередь утренний exec web-push «Требует тебя сегодня» (channel=webpush).',
      labelNames: ['channel'] as const,
    });

    this.blockerSynthesisRecurringTotal = this.getOrCreateCounter({
      name: 'blocker_synthesis_recurring_total',
      help: 'TZ-1 Ф3.A — синтезированный кластер блокеров по статусу (status ∈ new|recurring|resolved).',
      labelNames: ['status'] as const,
    });
    this.decisionStalledTotal = this.getOrCreateCounter({
      name: 'decision_stalled_total',
      help: 'TZ-1 Ф3.B — решение помечено stalled контролёром внедрения (0 задач + нет actualOutcomes старше N дней).',
      labelNames: [] as const,
    });
    this.decisionThroughputPercent = this.getOrCreateGauge({
      name: 'decision_throughput_percent',
      help: 'TZ-1 Ф3.B — доля решений, доведённых до actualOutcomes, % (несущая метрика витрины Ф5).',
      labelNames: ['tenant_top'] as const,
    });
    this.themeSilenceSurfacedTotal = this.getOrCreateCounter({
      name: 'theme_silence_surfaced_total',
      help: 'Редизайн Ф8.2 — surface риска «тема молчит N недель» (severity ∈ medium|high|critical), на создание Insight.',
      labelNames: ['severity'] as const,
    });
    this.decisionAutoImplementedTotal = this.getOrCreateCounter({
      name: 'decision_auto_implemented_total',
      help: 'Редизайн Ф8.1 — детерминированный авто-переход решения approved→implemented (есть outcomes ИЛИ все связанные задачи закрыты).',
      labelNames: [] as const,
    });
    this.promiseCascadeAlertTotal = this.getOrCreateCounter({
      name: 'promise_cascade_alert_total',
      help: 'TZ-1 Ф3.C — дневной алерт каскада обещаний (просроченное обещание держит чужую работу).',
      labelNames: [] as const,
    });

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
      help: "TZ-1 Ф4.A — уведомление автору/supporter'ам о смене статуса идеи доставлено.",
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
    this.telegramBotGlobalWebhookReceivedTotal = this.getOrCreateCounter({
      name: 'telegram_bot_global_webhook_received_total',
      help: 'β-9 — Webhook Update от глобального Telegram-бота (без `:tenantId` в URL). type = message/edited_message/unknown.',
      labelNames: ['type'] as const,
    });
    this.telegramBotUnknownSenderTotal = this.getOrCreateCounter({
      name: 'telegram_bot_unknown_sender_total',
      help: 'β-9 — Входящие в глобальный Telegram-бот от незнакомых отправителей. reason: no_binding | no_membership.',
      labelNames: ['reason'] as const,
    });
    this.adminTelegramBotActionsTotal = this.getOrCreateCounter({
      name: 'admin_telegram_bot_actions_total',
      help: 'β-9 Phase 4 — действия super-admin в админке над глобальным Telegram-ботом. action ∈ token_changed | webhook_reset | status_toggled | templates_updated | settings_read | bindings_read.',
      labelNames: ['action'] as const,
    });
    this.botLoginCommandTotal = this.getOrCreateCounter({
      name: 'bot_login_command_total',
      help: 'β-9 Phase 6 — команда /login в Telegram-боте. outcome = ok|not_linked|user_not_found.',
      labelNames: ['outcome'] as const,
    });

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
        "audit С3 — BillingService.safeEmit() поймал ошибку listener'а " +
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
    this.botCheckinIntentClassifierTotal = this.getOrCreateCounter({
      name: 'z_bot_checkin_intent_classifier_total',
      help: 'ТЗ 2026-05-29 telegram-self-initiated-checkins — распознавание plan/report в bot-адаптере (kind: morning/evening; source: llm/fallback_heuristic/fallback_factual_at_llm_fail).',
      labelNames: ['channel', 'kind', 'source'] as const,
    });
    this.botDailyCheckinSelfTotal = this.getOrCreateCounter({
      name: 'z_bot_daily_checkin_self_total',
      help: 'ТЗ 2026-05-29 telegram-self-initiated-checkins — outcome обработки self-initiated daily_checkin_self (saved/low_parser_confidence_curator_review/no_person/no_membership/error).',
      labelNames: ['channel', 'kind', 'outcome'] as const,
    });

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
    this.conflictArbiterTotal = this.getOrCreateCounter({
      name: 'z_conflict_arbiter_total',
      help: 'Autonomy W1 — исходы ночного LLM-арбитра конфликтов знаний (ConflictArbiterCron): verdict дебата × outcome ∈ auto_resolved|left_open|error.',
      labelNames: ['verdict', 'outcome'] as const,
    });
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
    this.coreSpecialistSkippedTotal = this.getOrCreateCounter({
      name: 'core_specialist_skipped_total',
      help: 'Ф3 МТЗ — ранние skip-return хендлеров специалистов Слоя 3 (specialist × reason). reason: block_not_found / tenant_mismatch / not_canonical / signal_out_of_scope. До этого skip был неотличим от success.',
      labelNames: ['specialist', 'reason'] as const,
    });
    this.kcTypedEntityFailedTotal = this.getOrCreateCounter({
      name: 'kc_typed_entity_failed_total',
      help: 'Ф5 МТЗ — провалы записи типизированной сущности группы Б в block-ingest (type × reason). type: process/regulation/policy/tool/metric/decision. reason: age_unavailable (системный отказ графа) / validation_error / idempotent_skip (P2002 гонка — норма) / other. age_unavailable блокирует пометку RawEvent ingested → failed+ретрай.',
      labelNames: ['type', 'reason'] as const,
    });
    this.kcSubjectAttributionTotal = this.getOrCreateCounter({
      name: 'kc_subject_attribution_total',
      help: 'Ф1 (knowledge-access) — детерминированная subject-атрибуция автора знания по источнику identity. via: participant (speakerParticipantId) / userId / personId / email / name (fuzzy) / none (автор не определён).',
      labelNames: ['via'] as const,
    });
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
    this.kcMaterializationGapTotal = this.getOrCreateCounter({
      name: 'kc_materialization_gap_total',
      help: 'knowledge-core — встречи, где блоки с signalType (decision/idea) есть, а соответствующая запись (Decision/Idea) не материализовалась (type).',
      labelNames: ['type'] as const,
    });
    this.goalThemeAutolinkTotal = this.getOrCreateCounter({
      name: 'goal_theme_autolink_total',
      help: 'knowledge-core — детерминированные авто-привязки Goal↔Theme (GoalTheme source=ai). method: provenance (блоки-источники цели уже в теме) | comention (тема упоминает те же сущности).',
      labelNames: ['method'] as const,
    });
    this.goalTaskLinkTotal = this.getOrCreateCounter({
      name: 'z_goal_task_link_total',
      help: 'knowledge-core — LLM-привязка задач встречи к AI-цели (goal-task-link, DEFAULT OFF). result: linked (Issue.goalId проставлен) | rejected (develops=false / низкий confidence / уже привязана) | fallback (арбитр провалился) | skipped.',
      labelNames: ['result'] as const,
    });
    this.meetingIngestFailedTotal = this.getOrCreateCounter({
      name: 'meeting_ingest_failed_total',
      help: 'Ф7 МТЗ — провалы моста встреча→knowledge-core (analyze.worker → MeetingIngestAdapter.ingestMeeting). reason: source_inactive / no_merged_transcript / without_tenant / quota_exceeded / other. Раньше провал глушился в resolved-null (встреча выглядела «зелёной», RawEvent не создавался). Теперь reject виден через failureReason + ретрай-cron meeting-reingest.',
      labelNames: ['reason'] as const,
    });
    this.coreSpecialistConflictEvolvingTotal = this.getOrCreateCounter({
      name: 'core_specialist_conflict_evolving_total',
      help: 'SBA β-3 — конфликты с suggested resolution=evolving, репортированные специалистами (type). Для Decision: новая версия → старая → ConflictItem(evolving).',
      labelNames: ['type'] as const,
    });
    this.decisionSupersedeChainLength = this.getOrCreateHistogram({
      name: 'decision_supersede_chain_length',
      help: 'SBA β-3 — длина supersede-цепочек Decision (chain length = сколько раз решение переписывалось). 0 — изначальное, 1 — заменено один раз, и т.д.',
      labelNames: [] as const,
      buckets: [0, 1, 2, 3, 5, 8, 13, 21],
    });

    this.goalKrAutoprogressTotal = this.getOrCreateCounter({
      name: 'goal_kr_autoprogress_total',
      help: "Goals OKR v2 Фаза 3 — попытки авто-пересчёта GoalKeyResult.currentValue cron'ом (source_kind × status). status: ok|unchanged|skipped|error.",
      labelNames: ['source_kind', 'status'] as const,
    });

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

    this.temporalEdgesInvalidatedTotal = this.getOrCreateCounter({
      name: 'temporal_edges_invalidated_total',
      help: "Agents v2 Фаза A1 — сколько existing open-links (block↔block + entity↔entity) было закрыто TemporalConflictService при детектировании противоречащей новой связи (validUntil=NOW). relationType — закрытого link'а.",
      labelNames: ['relationType'] as const,
    });
    this.temporalFilterHitsTotal = this.getOrCreateCounter({
      name: 'temporal_filter_hits_total',
      help: 'Agents v2 Фаза A1 — каждый edge, обработанный bi-temporal retrieval-фильтром. passed = валиден на момент validAt; filtered_out = отсеян.',
      labelNames: ['result'] as const,
    });
    this.edgesWithTemporalTotal = this.getOrCreateGauge({
      name: 'edges_with_temporal_total',
      help: "Agents v2 Фаза A1 — gauge: сколько edges (block|entity) имеют непустые bi-temporal поля. Обновляется ежечасным snapshot-cron'ом.",
      labelNames: ['type'] as const,
    });

    this.debateJudgmentsTotal = this.getOrCreateCounter({
      name: 'z_debate_judgments_total',
      help: "Agents v2 Фаза A2 — финальный verdict одного debate-run'а (`new`/`merge`/`supersedes`/`split_uncertain`). consensus_type ∈ unanimous|majority|split.",
      labelNames: ['task_type', 'decision', 'consensus_type'] as const,
    });
    this.debateCostUsdTotal = this.getOrCreateCounter({
      name: 'z_debate_cost_usd_total',
      help: "Agents v2 Фаза A2 — суммарный USD-cost всех debate-run'ов (tenant_top × task_type). tenant_top — top-100 bucket через tenantTopOf, cardinality ≤ 101.",
      labelNames: ['tenant_top', 'task_type'] as const,
    });
    this.debateRound2TriggeredTotal = this.getOrCreateCounter({
      name: 'z_debate_round2_triggered_total',
      help: "Agents v2 Фаза A2 — round 2 запущен при split-verdict'е round 1.",
      labelNames: ['task_type'] as const,
    });
    this.debateProviderDisagreementTotal = this.getOrCreateCounter({
      name: 'z_debate_provider_disagreement_total',
      help: "Agents v2 Фаза A2 — пара провайдеров, которые НЕ согласились в round 1 (разные verdict'ы). provider_a/provider_b — лексикографически отсортированы для нормализации.",
      labelNames: ['provider_a', 'provider_b', 'task_type'] as const,
    });
    this.debateFallbackToSingleTotal = this.getOrCreateCounter({
      name: 'z_debate_fallback_to_single_total',
      help: 'Agents v2 Фаза A2 — debate сорвался, Specialist вернулся к одиночному LLM-вызову. reason ∈ cost_cap | provider_unavailable.',
      labelNames: ['reason'] as const,
    });

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

    this.kcProjectionRebuildTotal = this.getOrCreateCounter({
      name: 'kc_projection_rebuild_total',
      help: 'KC-Temporal W3.5 — сколько rebuild-jobs было поставлено в очередь (type = decision|insight|idea|card|regulation|process|policy|skill_trait|process_template|experiment).',
      labelNames: ['type'] as const,
    });
    this.kcProjectionRebuildLagMs = this.getOrCreateHistogram({
      name: 'kc_projection_rebuild_lag_ms',
      help: "KC-Temporal W3.5 — lag между событием `idea_block.updated` и enqueue rebuild-job'а в миллисекундах (без учёта дебаунса BullMQ).",
      labelNames: [] as const,
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    });

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

    this.insightsDynamicLabelCount = this.getOrCreateGauge({
      name: 'insights_dynamic_label_count',
      help: "SBA β-4 — сколько активных Insight'ов сейчас в каждом dynamicLabel-сегменте (label: growing | stable | declining | spike).",
      labelNames: ['label'] as const,
    });

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
      help: "SBA β-5 — сколько probe-событий отброшено по rate-limit'у получателя.",
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
    this.probeOutcomeTotal = this.getOrCreateCounter({
      name: 'probe_outcome_total',
      help: 'Probe Фаза 5 — исход probe: answered (ответил) | ignored (истёк без ответа), по reason. Калибровочный сигнал для Фазы 2 (LLM-judge ценности вопроса).',
      labelNames: ['outcome', 'reason'] as const,
    });
    this.ownerResolutionTotal = this.getOrCreateCounter({
      name: 'z_owner_resolution_total',
      help: 'W2 autonomy — исход «лестницы владельца» для missing_owner: auto (Кора назначила сама) | ambiguous (вопрос-выбор) | none (некому, probe как раньше).',
      labelNames: ['outcome'] as const,
    });
    this.assistantTurnTotal = this.getOrCreateCounter({
      name: 'z_assistant_turn_total',
      help: 'Ф5/Ф6 assistant-channels — исход одного хода помощника в канале (AssistantChannelBridge): ok | error | quota | confirm_hold (мутация отложена до текстового «да») | handler_error (внешний catch, ответ потерян).',
      labelNames: ['outcome'] as const,
    });

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
      help: "Agents v2 Фаза B1 — gauge: сколько правил по (prompt_key × status × source). Обновляется hourly snapshot-cron'ом (Фаза C); в Фазе B заведён, но не обновляется.",
      labelNames: ['prompt_key', 'status', 'source'] as const,
    });
    this.autoruleOverriddenTotal = this.getOrCreateCounter({
      name: 'z_autorule_overridden_total',
      help: "Agents v2 Фаза B1 — каждое нажатие admin'ом «Заблокировать» (status=overridden_by_admin, sticky).",
      labelNames: ['prompt_key'] as const,
    });

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
      help: "Agents v2 Фаза C1 — каждое решение evaluator'а перевести shadow → active.",
      labelNames: [] as const,
    });
    this.practiceSkillsArchivedTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_archived_total',
      help: "Agents v2 Фаза C1 — каждое решение evaluator'а перевести skill в archived (composite < baseline).",
      labelNames: [] as const,
    });
    this.practiceSkillsRunsTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_runs_total',
      help: 'Agents v2 Фаза C1 — каждое использование PracticeSkill в clone-respond (status=shadow|active).',
      labelNames: ['status'] as const,
    });
    this.practiceSkillsCompositeVsBaseline = this.getOrCreateHistogram({
      name: 'z_practice_skills_composite_score_vs_baseline',
      help: "Agents v2 Фаза C1 — delta(composite_score - baseline_score) после оценки skill'а evaluator'ом.",
      labelNames: [] as const,
      buckets: [-0.5, -0.3, -0.15, -0.05, 0, 0.05, 0.1, 0.15, 0.3, 0.5],
    });
    this.practiceSkillsRetrievalHitTotal = this.getOrCreateCounter({
      name: 'z_practice_skills_retrieval_hits_total',
      help: 'Agents v2 Фаза C1 — каждый retrieval-вызов, вернувший ≥1 PracticeSkill для clone-respond.',
      labelNames: ['scope'] as const,
    });

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
      help: "Agents v2 Фаза C2 — auto-rollback кандидата ab-monitor cron'ом (reason=ab_deg|manual|stale).",
      labelNames: ['reason'] as const,
    });

    this.ideaStatusChangeNotificationsTotal = this.getOrCreateCounter({
      name: 'idea_status_change_notifications_total',
      help: "SBA β-5 — сколько уведомлений о смене статуса идеи отправлено supporter'ам (new_status).",
      labelNames: ['new_status'] as const,
    });

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
    this.chatV2ReasoningChainsAttachedTotal = this.getOrCreateCounter({
      name: 'chat_v2_reasoning_chains_attached_total',
      help: 'KC-Temporal W3.2 — сколько reasoning chain подмешано в контекст ответа Chat-v2 (label depth=1|2).',
      labelNames: ['depth'] as const,
    });
    this.chatV2ContradictingBlocksInContext = this.getOrCreateHistogram({
      name: 'chat_v2_contradicting_blocks_in_context',
      help: 'KC-Temporal W3.3 — число contradicting блоков в LLM-контексте ответа Chat-v2 (за один ask).',
      labelNames: [] as const,
      buckets: [0, 1, 2, 3, 5, 8, 12],
    });

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

    this.personaRebuildTriggeredTotal = this.getOrCreateCounter({
      name: 'persona_rebuild_triggered_total',
      help: 'Фаза 5 clone-reliability — сколько раз cron-watcher триггернул rebuild ExecutablePersona по reason: trait_delta | max_age.',
      labelNames: ['reason'] as const,
    });

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
      help: "SBA α-8 wave 3 — KPI с lastMeasuredAt вне frequency-окна (tenant_top × frequency). Считается cron-job'ом (если включён) или ad-hoc.",
      labelNames: ['tenant_top', 'frequency'] as const,
    });
    this.personRoleToAppointmentMigrationProgress = this.getOrCreateGauge({
      name: 'person_role_to_appointment_migration_progress',
      help: 'SBA α-8 wave 3 — доля PersonRole, у которых уже есть Appointment с тем же (personId,roleId,validFrom) (0..1; tenant_top).',
      labelNames: ['tenant_top'] as const,
    });

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
      help: 'SBA β-8 — результат запуска PersonalRelationBuilderWorker. result ∈ link_created|link_updated|skipped_low_confidence|skipped_no_pair|error.',
      labelNames: ['tenant_top', 'result'] as const,
    });

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
      labelNames: ['tenant_top', 'task_type', 'provider', 'model', 'success'] as const,
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
    this.probeGoalAlignmentLowEmittedTotal = this.getOrCreateCounter({
      name: 'probe_goal_alignment_low_emitted_total',
      help: 'Wave 3 finishing — emitted probe-events «goal_alignment_low» (≥80% issues пользователя за 14д без связи с Goal).',
      labelNames: ['tenant_top'] as const,
    });

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

  incRecordingsBytes(bytes: number): void {
    this.recordingsBytesTotal.inc(bytes);
  }

  incRecordingDeleted(reason: string): void {
    this.recordingsDeletedTotal.inc({ reason });
  }

  incRecordingsDeleted(args: { reason: string }): void {
    this.recordingsDeletedTotal.inc({ reason: args.reason });
  }

  incRecordingFailed(reason: string): void {
    this.recordingsFailedTotal.inc({ reason });
  }

  incTrackEgressStartFailed(args: { reason: string }): void {
    this.recordingTrackEgressFailedTotal.inc({ reason: args.reason });
  }

  incRecordingsFailed(args: { reason: string }): void {
    this.recordingsFailedTotal.inc({ reason: args.reason });
  }

  incLlmFallback(provider: string): void {
    this.llmFallbackTotal.inc({ provider });
  }

  incPromptResolver(args: { source: 'db_org' | 'db_system' | 'code_fallback' }): void {
    this.promptResolverTotal.inc({ source: args.source });
  }

  incPromptResolverFallback(args: { reason: 'db_empty' | 'db_error' }): void {
    this.promptResolverFallbackTotal.inc({ reason: args.reason });
  }

  incPromptInjectionAttempt(args: {
    source: 'custom_prompt' | 'transcript' | 'chat';
    pattern: string;
  }): void {
    this.promptInjectionAttemptTotal.inc({
      source: args.source,
      pattern: args.pattern,
    });
  }

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

  incQueryPlanExtraction(args: { result: 'applied' | 'failopen' }): void {
    this.queryPlanExtractionTotal.inc({ result: args.result });
  }
  incQueryPlanRetrievalFiltered(args: { filtered: 'yes' | 'no' }): void {
    this.queryPlanRetrievalFilteredTotal.inc({ filtered: args.filtered });
  }
  incQueryPlanEmptyPool(args: { result: 'empty' }): void {
    this.queryPlanEmptyPoolTotal.inc({ result: args.result });
  }

  incTaskAssigneeAmbiguous(args: {
    tenant: string;
    reason: 'duplicate_name' | 'llm_hallucination';
  }): void {
    this.taskAssigneeAmbiguousTotal.inc({
      tenant: args.tenant,
      reason: args.reason,
    });
  }

  setPromptTemplateActiveCount(args: { scope: 'system' | 'org'; count: number }): void {
    this.promptTemplateActiveCount.set({ scope: args.scope }, args.count);
  }

  incPromptTemplatePreview(args: { result: 'success' | 'error' | 'cost_limit' }): void {
    this.promptTemplatePreviewTotal.inc({ result: args.result });
  }

  setPromptExperimentActiveCount(args: { count: number }): void {
    this.promptExperimentActiveCount.set(args.count);
  }

  incPromptExperimentCompleted(args: { reason: 'finished' | 'stopped' | 'expired' }): void {
    this.promptExperimentCompletedTotal.inc({ reason: args.reason });
  }

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

  observeEgressEndedGap(requestType: string, gapSeconds: number): void {
    if (gapSeconds >= 0)
      this.livekitEgressEndedGapSeconds.observe({ request_type: requestType }, gapSeconds);
  }

  incGoalKrAutoprogress(
    sourceKind: string,
    status: 'ok' | 'skipped' | 'unchanged' | 'error',
  ): void {
    this.goalKrAutoprogressTotal.inc({ source_kind: sourceKind, status });
  }

  incGoalsPulseGenerated(args: { tenantTop: string }): void {
    this.goalsPulseGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  incGoalsPulseFailed(args: { tenantTop: string; reason: string }): void {
    this.goalsPulseFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  incGoalsPulseDelivered(args: { tenantTop: string; channel: string }): void {
    this.goalsPulseDeliveredTotal.inc({
      tenant_top: args.tenantTop,
      channel: args.channel,
    });
  }

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

  incLlmCacheHit(args: { provider: string; model: string; taskType: string }): void {
    this.llmCacheHitTotal.inc({
      provider: args.provider,
      model: args.model,
      task_type: args.taskType,
    });
  }

  addLlmCacheReadTokens(args: { provider: string; model: string; tokens: number }): void {
    if (args.tokens <= 0) return;
    this.llmCacheReadTokensTotal.inc({ provider: args.provider, model: args.model }, args.tokens);
  }

  addLlmCacheCreationTokens(args: { provider: string; model: string; tokens: number }): void {
    if (args.tokens <= 0) return;
    this.llmCacheCreationTokensTotal.inc(
      { provider: args.provider, model: args.model },
      args.tokens,
    );
  }

  incLlmCall(args: { provider: string }): void {
    this.llmCallsTotal.inc({ provider: args.provider });
  }

  setLlmCacheHitRatioBelowThreshold(args: { provider: string; below: boolean }): void {
    this.llmCacheHitRatioBelowThreshold.set({ provider: args.provider }, args.below ? 1 : 0);
  }

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

  incDeepseekSchemaToToolConversion(args: { model: string }): void {
    this.deepseekSchemaToToolConversionTotal.inc({ model: args.model });
  }

  incLlmThinkingModelGuard(args: {
    kind: 'schema-to-tool' | 'strict-stripped' | 'tool-choice-relaxed';
    model: string;
  }): void {
    this.llmThinkingModelGuardTotal.inc({ kind: args.kind, model: args.model });
  }

  incCoreLlmNoProvider(args: { taskType: string }): void {
    this.coreLlmNoProviderTotal.inc({ task_type: args.taskType });
  }

  incLlmCostUnpriced(args: { provider: string; model: string }): void {
    this.llmCostUnpricedTotal.inc({ provider: args.provider, model: args.model });
  }

  incKcBlockLinkerFallbackNone(args: { reason: string }): void {
    this.kcBlockLinkerFallbackNoneTotal.inc({ reason: args.reason });
  }

  incKcBlockLinkerInvalidJson(args: { reason: string }): void {
    this.kcBlockLinkerInvalidJsonTotal.inc({ reason: args.reason });
  }

  incKcEntityGraphInvalidJson(args: { reason: string }): void {
    this.kcEntityGraphInvalidJsonTotal.inc({ reason: args.reason });
  }

  incKcEntityGraphFallbackNone(args: { reason: string }): void {
    this.kcEntityGraphFallbackNoneTotal.inc({ reason: args.reason });
  }

  incTaskDedupe(args: { result: string }): void {
    this.taskDedupeTotal?.inc({ result: args.result });
  }

  incChatboxSync(args: { scope: string; status: 'success' | 'failed' }): void {
    this.chatboxSyncsTotal?.inc({ scope: args.scope, status: args.status });
  }

  incChatboxAnalyze(args: { status: 'success' | 'failed' }): void {
    this.chatboxAnalyzesTotal?.inc({ status: args.status });
  }

  setChatboxPendingSessions(count: number): void {
    this.chatboxPendingSessions?.set(count);
  }

  setChatboxLastSyncTs(args: { scope: string; tsSeconds: number }): void {
    this.chatboxLastSyncTsSeconds?.set({ scope: args.scope }, args.tsSeconds);
  }

  incAdminAiModelsRouteChange(args: { taskType: string; changeType: string }): void {
    this.adminAiModelsRouteChangeTotal.inc({
      task_type: args.taskType,
      change_type: args.changeType,
    });
  }

  incAdminAiModelsExperimentStarted(args: { taskType: string }): void {
    this.adminAiModelsExperimentStartedTotal.inc({ task_type: args.taskType });
  }

  incAdminAiModelsExperimentStopped(args: { taskType: string }): void {
    this.adminAiModelsExperimentStoppedTotal.inc({ task_type: args.taskType });
  }

  incAdminAiModelsExperimentCompleted(args: { taskType: string }): void {
    this.adminAiModelsExperimentCompletedTotal.inc({ task_type: args.taskType });
  }

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

  incWebhookDelivery(args: { event: string; status: 'delivered' | 'retrying' | 'failed' }): void {
    this.webhookDeliveryTotal.inc({ event: args.event, status: args.status });
  }

  incQuotaExceeded(args: { quotaName: string }): void {
    this.quotaExceededTotal.inc({ quota_name: args.quotaName });
  }

  incExportCompleted(args: { type: string; status: 'ready' | 'failed' }): void {
    this.exportCompletedTotal.inc({ type: args.type, status: args.status });
  }

  incChatRequest(args: { scope: 'single' | 'cross' | 'card' }): void {
    this.chatRequestTotal.inc({ scope: args.scope });
  }

  incCardEvent(args: {
    kind: string;
    action: 'created' | 'updated' | 'deleted' | 'restored';
  }): void {
    this.cardsTotal.inc({ kind: args.kind, action: args.action });
  }

  incCardRollupRun(args: { status: 'success' | 'skipped' | 'failed' }): void {
    this.cardRollupRunsTotal.inc({ status: args.status });
  }

  incCoreRetentionDeleted(args: { kind: string; count?: number }): void {
    const n = args.count ?? 1;
    if (n <= 0) return;
    this.coreRetentionDeletedTotal.inc({ kind: args.kind }, n);
  }

  incCorePersonalDataErasure(): void {
    this.corePersonalDataErasuresTotal.inc(1);
  }

  incCoreDataClassViolation(args: { taskType: string; attemptedClass: string }): void {
    this.coreDataClassViolationsTotal.inc({
      task_type: args.taskType,
      attempted_class: args.attemptedClass,
    });
  }

  incLlmBudgetExceeded(args: { mode: string }): void {
    this.llmBudgetExceededTotal.inc({ mode: args.mode });
  }

  setCoreBlocks(args: { tenant: string; status: string; count: number }): void {
    this.coreBlocksTotal.set({ tenant: args.tenant, status: args.status }, args.count);
  }

  setCoreEntities(args: { tenant: string; type: string; count: number }): void {
    this.coreEntitiesTotal.set({ tenant: args.tenant, type: args.type }, args.count);
  }

  setKcFactsOpen(args: { tenant: string; signalType: string; count: number }): void {
    this.kcFactsOpenGauge.set({ tenant: args.tenant, signal_type: args.signalType }, args.count);
  }

  setCoreLinks(args: { tenant: string; relationType: string; count: number }): void {
    this.coreLinksTotal.set({ tenant: args.tenant, relation_type: args.relationType }, args.count);
  }

  setCoreRawEvents(args: { tenant: string; processingStatus: string; count: number }): void {
    this.coreRawEventsTotal.set(
      { tenant: args.tenant, processing_status: args.processingStatus },
      args.count,
    );
  }

  observeCorePipelineDuration(args: { worker: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.corePipelineDurationSeconds.observe({ worker: args.worker }, args.seconds);
  }

  addCoreLlmTokens(args: { tenant: string; taskType: string; tokens: number }): void {
    if (args.tokens <= 0) return;
    this.coreLlmTokensTotal.inc({ tenant: args.tenant, task_type: args.taskType }, args.tokens);
  }

  incExtractionEntity(args: { type: string; count?: number }): void {
    const n = args.count ?? 1;
    if (n <= 0) return;
    this.extractionEntitiesTotal.inc({ type: args.type }, n);
  }

  observeExtractionConfidence(args: { type: string; confidence: number }): void {
    if (args.confidence < 0 || args.confidence > 1) return;
    this.extractionConfidence.observe({ type: args.type }, args.confidence);
  }

  incExtractionAmbiguous(args: { type: string }): void {
    this.extractionAmbiguousTotal.inc({ type: args.type });
  }

  incEntityResolutionDedup(args: { type: string; action: string }): void {
    this.entityResolutionDedupTotal.inc({
      type: args.type,
      action: args.action,
    });
  }

  incBehaviorMetricsComputed(): void {
    this.behaviorMetricsComputedTotal.inc();
  }

  incBehaviorMetricsFailed(): void {
    this.behaviorMetricsFailedTotal.inc();
  }

  incBehaviorMetricsLowConfidence(): void {
    this.behaviorMetricsLowConfidenceTotal.inc();
  }

  observeBehaviorMetricsDuration(seconds: number): void {
    this.behaviorMetricsDurationSeconds.observe(seconds);
  }

  incBehaviorMetricsLlmRefine(args: { status: 'success' | 'failed' }): void {
    this.behaviorMetricsLlmRefineTotal.inc({ status: args.status });
  }

  incQualityScoreComputed(): void {
    this.qualityScoreComputedTotal.inc();
  }

  incQualityScoreFailed(): void {
    this.qualityScoreFailedTotal.inc();
  }

  incQualityScoreDisabled(args: { reason: 'too_short' | 'org_setting' }): void {
    this.qualityScoreDisabledTotal.inc({ reason: args.reason });
  }

  incQualityScoreRegenerate(): void {
    this.qualityScoreRegenerateTotal.inc();
  }

  setQualityScoreAvg(orgId: string, avg: number): void {
    this.qualityScoreAvg.set({ org_id: orgId }, avg);
  }

  incQualityScoreLlmCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.qualityScoreLlmCostUsd.inc(usd);
  }

  incTranscriptCleaningCompleted(): void {
    this.transcriptCleaningCompletedTotal.inc();
  }

  incTranscriptCleaningFailed(): void {
    this.transcriptCleaningFailedTotal.inc();
  }

  observeTranscriptCleaningDuration(seconds: number): void {
    this.transcriptCleaningDurationSeconds.observe(seconds);
  }

  observeTranscriptCleaningCharsReduced(ratio: number): void {
    this.transcriptCleaningCharsReduced.observe(Math.max(0, Math.min(1, ratio)));
  }

  addTranscriptCleaningLlmCostUsd(usd: number): void {
    if (usd > 0) this.transcriptCleaningLlmCostUsdTotal.inc(usd);
  }

  incMeetingReportCreated(args: { kind: 'primary' | 'additional' }): void {
    this.meetingReportCreatedTotal.inc({ kind: args.kind });
  }

  incMeetingReportGenerated(): void {
    this.meetingReportGeneratedTotal.inc();
  }

  incMeetingReportFailed(args: { reason: 'llm_error' | 'cost_limit' | 'other' }): void {
    this.meetingReportFailedTotal.inc({ reason: args.reason });
  }

  incMeetingReportRegenerated(): void {
    this.meetingReportRegeneratedTotal.inc();
  }

  incMeetingReportDeleted(): void {
    this.meetingReportDeletedTotal.inc();
  }

  observeMeetingReportDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.meetingReportDurationSeconds.observe(seconds);
  }

  incMeetingReportLlmCost(usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.meetingReportLlmCostUsd.inc(usd);
  }

  incMeetingReportFast(args: { tenant: string; status: 'ready' | 'failed' | 'partial' }): void {
    this.meetingReportFastTotal.inc({
      tenant: args.tenant,
      status: args.status,
    });
  }

  observeMeetingReportFastDuration(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.meetingReportFastDurationSeconds.observe(seconds);
  }

  incConversationalNotification(args: { eventType: string; status: string }): void {
    this.conversationalNotificationsTotal.inc({
      event_type: args.eventType,
      status: args.status,
    });
  }

  incConversationalDelivery(args: { kind: string; status: string }): void {
    this.conversationalDeliveriesTotal.inc({
      kind: args.kind,
      status: args.status,
    });
  }

  incNotificationBudgetConsumed(args: { trigger: string }): void {
    this.notificationBudgetConsumedTotal.inc({ trigger: args.trigger });
  }

  incNotificationBudgetBlocked(args: { reason: string }): void {
    this.notificationBudgetBlockedTotal.inc({ reason: args.reason });
  }

  incNotificationDeferredToDigest(): void {
    this.notificationDeferredToDigestTotal.inc();
  }

  setChannelBindingCoverageRatio(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.channelBindingCoverageRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incChannelBindingCampaignInvited(args: { tenantTop: string }): void {
    this.channelBindingCampaignInvitedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCheckinPromptDelivered(args: { channel: string }): void {
    this.checkinPromptDeliveredTotal.inc({ channel: args.channel });
  }

  incCustomerRiskSnapshots(args: { level: string }): void {
    this.customerRiskSnapshotsTotal.inc({ level: args.level });
  }

  incCustomerRiskRadarFailed(args: { reason: string }): void {
    this.customerRiskRadarFailedTotal.inc({ reason: args.reason });
  }

  setPortfolioHealthScore(args: { tenantTop: string; score: number }): void {
    if (!Number.isFinite(args.score)) return;
    this.portfolioHealthScore.set(
      { tenant_top: args.tenantTop },
      Math.min(100, Math.max(0, args.score)),
    );
  }

  incPortfolioHealthSnapshot(args: { tenantTop: string }): void {
    this.portfolioHealthSnapshotTotal.inc({ tenant_top: args.tenantTop });
  }

  incPortfolioPrioritySet(args: { tenantTop: string; priority: string }): void {
    this.portfolioPrioritySetTotal.inc({
      tenant_top: args.tenantTop,
      priority: args.priority,
    });
  }

  incCustomerRiskManagerNotified(): void {
    this.customerRiskManagerNotifiedTotal.inc();
  }

  incPersonalDailyBriefBuilt(): void {
    this.personalDailyBriefBuiltTotal.inc();
  }

  incPersonalDailyBriefDelivered(args: { channel: string }): void {
    this.personalDailyBriefDeliveredTotal.inc({ channel: args.channel });
  }

  incPersonalDailyBriefOpened(): void {
    this.personalDailyBriefOpenedTotal.inc();
  }

  incKnowsWhoMatch(args: { found: 'yes' | 'no' }): void {
    this.knowsWhoMatchTotal.inc({ found: args.found });
  }

  incExecMorningPushDelivered(args: { channel: string }): void {
    this.execMorningPushDeliveredTotal.inc({ channel: args.channel });
  }

  incBlockerSynthesisRecurring(args: { status: string }): void {
    this.blockerSynthesisRecurringTotal.inc({ status: args.status });
  }

  incDecisionStalled(): void {
    this.decisionStalledTotal.inc();
  }

  setDecisionThroughputPercent(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.decisionThroughputPercent.set(
      { tenant_top: args.tenantTop },
      Math.min(100, Math.max(0, args.value)),
    );
  }

  incThemeSilenceSurfaced(args: { severity: string }): void {
    this.themeSilenceSurfacedTotal.inc({ severity: args.severity });
  }

  incDecisionAutoImplemented(): void {
    this.decisionAutoImplementedTotal.inc();
  }

  incPromiseCascadeAlert(): void {
    this.promiseCascadeAlertTotal.inc();
  }

  incIdeasTopServed(): void {
    this.ideasTopServedTotal.inc();
  }

  incIdeaStatusAutoAdvanced(args: { to: string }): void {
    this.ideaStatusAutoAdvancedTotal.inc({ to: args.to });
  }

  incIdeaStatusChangedNotified(): void {
    this.ideaStatusChangedNotifiedTotal.inc();
  }

  incInsightRechecked(args: { reactivated: boolean }): void {
    this.insightRecheckedTotal.inc({
      reactivated: args.reactivated ? 'true' : 'false',
    });
  }

  incKnowledgeAtRisk(args: { severity: string }): void {
    this.knowledgeAtRiskTotal.inc({ severity: args.severity });
  }

  incTeamCapacityOverload(): void {
    this.teamCapacityOverloadTotal.inc();
  }

  incOnboardingRampStalled(): void {
    this.onboardingRampStalledTotal.inc();
  }

  incValueRecapBuilt(): void {
    this.valueRecapBuiltTotal.inc();
  }

  incValueRecapDelivered(args: { channel: string }): void {
    this.valueRecapDeliveredTotal.inc({ channel: args.channel });
  }

  incValueRecapOpened(): void {
    this.valueRecapOpenedTotal.inc();
  }

  incChatV2Feedback(args: { reaction: 'up' | 'down' }): void {
    this.chatV2FeedbackTotal.inc({ reaction: args.reaction });
  }

  setChatAnsweredWithCitation(args: { mode: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.chatV2AnsweredWithCitation.set({ mode: args.mode }, Math.max(0, args.value));
  }

  incConversationalInbound(args: { kind: string; type: string }): void {
    this.conversationalInboundTotal.inc({
      kind: args.kind,
      type: args.type,
    });
  }

  incConversationalLinkAttempt(args: { kind: string; status: string }): void {
    this.conversationalLinkAttemptsTotal.inc({
      kind: args.kind,
      status: args.status,
    });
  }

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

  incTelegramBotApiError(args: { apiMethod: string; code: string }): void {
    this.telegramBotApiErrorsTotal.inc({
      api_method: args.apiMethod,
      code: args.code,
    });
  }

  incTelegramBotWebhookReceived(args: { type: string }): void {
    this.telegramBotWebhookReceivedTotal.inc({ type: args.type });
  }

  incTelegramProxyRequest(args: {
    apiMethod: string;
    outcome: 'ok' | 'proxy_5xx' | 'proxy_4xx' | 'telegram_5xx' | 'telegram_4xx' | 'network';
  }): void {
    this.telegramProxyRequestTotal.inc({
      api_method: args.apiMethod,
      outcome: args.outcome,
    });
  }

  observeTelegramProxyRequestDuration(args: { apiMethod: string; durationSec: number }): void {
    this.telegramProxyRequestDurationSeconds.observe(
      { api_method: args.apiMethod },
      args.durationSec,
    );
  }

  incTelegramProxyHealthCheck(args: { outcome: 'ok' | 'fail' }): void {
    this.telegramProxyHealthCheckTotal.inc({ outcome: args.outcome });
  }

  incTelegramBotGlobalWebhookReceived(args: { type: string }): void {
    this.telegramBotGlobalWebhookReceivedTotal.inc({ type: args.type });
  }

  incTelegramBotUnknownSender(args: { reason: 'no_binding' | 'no_membership' }): void {
    this.telegramBotUnknownSenderTotal.inc({ reason: args.reason });
  }

  incBotLoginCommand(args: { outcome: 'ok' | 'not_linked' | 'user_not_found' }): void {
    this.botLoginCommandTotal.inc({ outcome: args.outcome });
  }

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

  incInviteCreated(args: { hasEmail: boolean }): void {
    this.inviteCreatedTotal.inc({ has_email: String(args.hasEmail) });
  }

  incInviteAccepted(args: { path: 'magic_link' | 'password' | 'telegram_first' }): void {
    this.inviteAcceptedTotal.inc({ path: args.path });
  }

  incInviteReminderSent(args: { day: 7 | 14 }): void {
    this.inviteReminderSentTotal.inc({ day: String(args.day) });
  }

  incInviteExpired(): void {
    this.inviteExpiredTotal.inc();
  }

  incMagicLinkRequest(args: { outcome: 'sent' | 'rate_limited' | 'user_not_found' }): void {
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

  incReferralAttributionFirstTouchLocked(): void {
    this.referralAttributionFirstTouchLockedTotal.inc();
  }

  incParticipantRenamed(): void {
    this.participantRenamedTotal.inc();
  }

  incBillingInvoiceCreated(args: {
    tenantTop: string;
    kind: 'acquiring' | 'bank' | 'manual';
  }): void {
    this.billingInvoiceCreatedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  incBillingInvoicePaid(args: { tenantTop: string; kind: 'acquiring' | 'bank' | 'manual' }): void {
    this.billingInvoicePaidTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  incBillingSubscriptionRenewed(args: { tenantTop: string; tier: string }): void {
    this.billingSubscriptionRenewedTotal.inc({
      tenant_top: args.tenantTop,
      tier: args.tier,
    });
  }

  incBillingSubscriptionCancelled(args: {
    tenantTop: string;
    reason: 'user_cancelled' | 'payment_failed' | 'manual_admin';
  }): void {
    this.billingSubscriptionCancelledTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  incBillingWebhookReceived(args: {
    provider: 'tochka';
    status: 'ok' | 'sig_fail' | 'replay' | 'invalid_payload';
  }): void {
    this.billingWebhookReceivedTotal.inc({
      provider: args.provider,
      status: args.status,
    });
  }

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

  incReferralClick(args: { partnerTop: string }): void {
    this.referralClickTotal.inc({ partner_top: args.partnerTop });
  }

  incReferralSignup(args: { partnerTop: string }): void {
    this.referralSignupTotal.inc({ partner_top: args.partnerTop });
  }

  incReferralPayoutCreated(args: { cronRunDate: string }): void {
    this.referralPayoutCreatedTotal.inc({ cron_run_date: args.cronRunDate });
  }

  incReferralPayoutAmountRub(amountRub: number): void {
    if (amountRub > 0 && Number.isFinite(amountRub)) {
      this.referralPayoutAmountRubTotal.inc(amountRub);
    }
  }

  incReferralPromoImpression(args: { role: 'owner' | 'member' }): void {
    this.referralPromoImpressionTotal.inc({ role: args.role });
  }

  incReferralPromoClick(args: { role: 'owner' | 'member' }): void {
    this.referralPromoClickTotal.inc({ role: args.role });
  }

  incReferralPromoDismissed(args: { role: 'owner' | 'member' }): void {
    this.referralPromoDismissedTotal.inc({ role: args.role });
  }

  incBillingEmitFailed(args: { event: string }): void {
    this.billingEmitFailedTotal.inc({ event: args.event });
  }

  incConciergeConfigError(args: {
    reason: 'dialog_layer_enabled' | 'tenant_scope' | 'other';
  }): void {
    this.conciergeConfigErrorTotal.inc({ reason: args.reason });
  }

  incReferralInnMismatch(args: { reason: 'lookup_inn_mismatch' | 'director_name_mismatch' }): void {
    this.referralInnMismatchTotal.inc({ reason: args.reason });
  }

  incMagicLinkConsume(args: { outcome: 'ok' | 'expired' | 'already_used' | 'invalid' }): void {
    this.magicLinkConsumeTotal.inc({ outcome: args.outcome });
  }

  incMaxBotApiError(args: { apiMethod: string; code: string }): void {
    this.maxBotApiErrorsTotal.inc({
      api_method: args.apiMethod,
      code: args.code,
    });
  }

  incMaxBotWebhookReceived(args: { type: string }): void {
    this.maxBotWebhookReceivedTotal.inc({ type: args.type });
  }

  incBotInbound(args: {
    channel: 'telegram_bot' | 'max_bot';
    kind:
      | 'text'
      | 'voice'
      | 'document'
      | 'start_command'
      | 'link_code'
      | 'other'
      | 'daily_checkin_self';
  }): void {
    this.botInboundTotal.inc({ channel: args.channel, kind: args.kind });
  }

  observeBotVoiceAsrDuration(args: { channel: 'telegram_bot' | 'max_bot'; seconds: number }): void {
    if (args.seconds < 0) return;
    this.botVoiceAsrDurationSeconds.observe({ channel: args.channel }, args.seconds);
  }

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

  incTelegramTasksCreated(args: {
    tenantTop: string;
    status: 'created' | 'auto_created' | 'failed' | 'intake_only';
  }): void {
    this.telegramTasksCreatedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  incTelegramVoiceTranscribed(args: {
    tenantTop: string;
    kind: 'create_task' | 'forward_to_task';
  }): void {
    this.telegramVoiceTranscribedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  incTelegramForwards(args: {
    tenantTop: string;
    status: 'created' | 'auto_created' | 'failed' | 'intake_only';
  }): void {
    this.telegramForwardsTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  incTelegramDigestSent(args: {
    tenantTop: string;
    result: 'sent' | 'empty' | 'dedup_skip' | 'error';
  }): void {
    this.telegramDigestSentTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  incPendingReminderSent(args: {
    tenantTop: string;
    result: 'sent' | 'empty' | 'dedup' | 'error';
  }): void {
    this.pendingReminderSentTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  incTelegramReplyClassified(args: {
    tenantTop: string;
    kind: 'status_command' | 'comment' | 'new_task' | 'unknown';
  }): void {
    this.telegramReplyClassifiedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

  incCoreRouterDispatched(args: { specialist: string; signalType: string }): void {
    this.coreRouterDispatchedTotal.inc({
      specialist: args.specialist,
      signal_type: args.signalType,
    });
  }

  observeCoreRouterFanOut(count: number): void {
    if (count < 0) return;
    this.coreRouterFanOut.observe(count);
  }

  incCoreRouterTrimmed(args: { signalType: string }): void {
    this.coreRouterTrimmedTotal.inc({ signal_type: args.signalType });
  }

  incCurationItem(args: { resourceType: string; level: string; status: string }): void {
    this.curationItemsTotal.inc({
      resource_type: args.resourceType,
      level: args.level,
      status: args.status,
    });
  }

  incCurationDecision(args: { decisionType: string; level: string }): void {
    this.curationDecisionTotal.inc({
      decision_type: args.decisionType,
      level: args.level,
    });
  }

  observeCurationTimeToDecide(args: { level: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.curationTimeToDecideSeconds.observe({ level: args.level }, args.seconds);
  }

  incCurationAutoCanonical(args: { resourceType: string }): void {
    this.curationAutoCanonicalTotal.inc({ resource_type: args.resourceType });
  }

  incCurationProvisional(args: { resourceType: string }): void {
    this.curationProvisionalTotal.inc({ resource_type: args.resourceType });
  }

  incCurationAuditSample(args: { resourceType: string }): void {
    this.curationAuditSampleTotal.inc({ resource_type: args.resourceType });
  }

  incCurationVerifierVerdict(args: { decision: string; consensusType: string }): void {
    this.curationVerifierVerdictTotal.inc({
      decision: args.decision,
      consensus_type: args.consensusType,
    });
  }

  incCurationConflict(args: { relationType: string; resolution: string }): void {
    this.curationConflictsTotal.inc({
      relation_type: args.relationType,
      resolution: args.resolution,
    });
  }

  incConflictArbiter(args: {
    verdict: string;
    outcome: 'auto_resolved' | 'left_open' | 'error';
  }): void {
    this.conflictArbiterTotal.inc({
      verdict: args.verdict,
      outcome: args.outcome,
    });
  }

  incCurationStale(args: { resourceType: string }): void {
    this.curationStaleDetectedTotal.inc({ resource_type: args.resourceType });
  }

  incCurationItemExpired(args: { resourceType: string }): void {
    this.curationItemExpiredTotal.inc({ resource_type: args.resourceType });
  }

  observeCurationItemAge(args: { level: string; seconds: number }): void {
    this.curationItemAgeSeconds.observe({ level: args.level }, args.seconds);
  }

  incCurationKillSwitch(args: { resourceType: string }): void {
    this.curationKillSwitchTotal.inc({ resource_type: args.resourceType });
  }

  incCurationAutotuneAdjustment(args: { resourceType: string; direction: 'up' | 'down' }): void {
    this.curationAutotuneAdjustmentTotal.inc({
      resource_type: args.resourceType,
      direction: args.direction,
    });
  }

  setCompletenessSlotsOpen(args: { cardType: string; value: number }): void {
    if (args.value < 0) return;
    this.completenessSlotsOpenTotal.set({ card_type: args.cardType }, args.value);
  }

  incCompletenessSlotsFilled(args: { cardType: string }): void {
    this.completenessSlotsFilledTotal.inc({ card_type: args.cardType });
  }

  incConsistencyViolation(args: { rule: string }): void {
    this.consistencyViolationsTotal.inc({ rule: args.rule });
  }

  observeConsistencyCheckerDuration(seconds: number): void {
    if (seconds < 0) return;
    this.consistencyCheckerDurationSeconds.observe(seconds);
  }

  setCoreSpecialistCards(args: { type: string; status: string; value: number }): void {
    this.coreSpecialistCardsTotal.set(
      { type: args.type, status: args.status },
      Math.max(0, args.value),
    );
  }

  incCoreSpecialistCards(args: { type: string; status: string }): void {
    this.coreSpecialistCardsTotal.inc({ type: args.type, status: args.status });
  }

  observeCoreSpecialistPipelineDuration(args: { type: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.coreSpecialistPipelineDurationSeconds.observe({ type: args.type }, args.seconds);
  }

  incCoreSpecialistSkipped(args: { specialist: string; reason: string }): void {
    this.coreSpecialistSkippedTotal.inc({
      specialist: args.specialist,
      reason: args.reason,
    });
  }

  incKcMaterializationGap(args: { type: string }): void {
    this.kcMaterializationGapTotal.inc({ type: args.type });
  }

  incGoalThemeAutolink(args: { method: string }): void {
    this.goalThemeAutolinkTotal.inc({ method: args.method });
  }

  incGoalTaskLink(args: { result: string }): void {
    this.goalTaskLinkTotal.inc({ result: args.result });
  }

  incTypedEntityFailed(args: { type: string; reason: string }): void {
    this.kcTypedEntityFailedTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  incSubjectAttribution(args: { via: string }): void {
    this.kcSubjectAttributionTotal.inc({ via: args.via });
  }

  incAccessShadowDiff(args: { surface: string }, count = 1): void {
    if (count > 0) this.kcAccessShadowDiffTotal.inc({ surface: args.surface }, count);
  }

  incAccessDenied(args: { surface: string }, count = 1): void {
    if (count > 0) this.kcAccessDeniedTotal.inc({ surface: args.surface }, count);
  }

  incIngestFailed(args: { reason: string }): void {
    this.meetingIngestFailedTotal.inc({ reason: args.reason });
  }

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

  incCoreSpecialistProbeEvent(args: { type: string; reason: string }): void {
    this.coreSpecialistProbeEventsTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  incCoreSpecialistConflictEvent(args: { type: string }): void {
    this.coreSpecialistConflictEventsTotal.inc({ type: args.type });
  }

  incCoreSpecialistExtractionFailure(args: { type: string; reason: string }): void {
    this.coreSpecialistExtractionFailuresTotal.inc({
      type: args.type,
      reason: args.reason,
    });
  }

  setProcessTemplatesTotal(args: { tenantTop: string; status: string; value: number }): void {
    if (args.value < 0) return;
    this.processTemplatesTotal.set({ tenant_top: args.tenantTop, status: args.status }, args.value);
  }

  setProcessTemplateCompletenessAvg(args: { tenantTop: string; value: number }): void {
    if (args.value < 0 || args.value > 1) return;
    this.processTemplateCompletenessAvg.set({ tenant_top: args.tenantTop }, args.value);
  }

  incProcessDetectorExtraction(args: {
    tenantTop: string;
    result: 'new' | 'updated' | 'skipped';
  }): void {
    this.processDetectorExtractionsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  observeProcessTemplateExtractDuration(seconds: number): void {
    if (seconds < 0) return;
    this.processTemplateExtractDurationSeconds.observe(seconds);
  }

  setCrossFunctionalProcessesTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.crossFunctionalProcessesTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

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

  observeCrossFunctionalFrictionResolutionTime(args: { tenantTop: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.crossFunctionalFrictionResolutionTimeSeconds.observe(
      { tenant_top: args.tenantTop },
      args.seconds,
    );
  }

  incCoreSpecialistConflictEvolving(args: { type: string }): void {
    this.coreSpecialistConflictEvolvingTotal.inc({ type: args.type });
  }

  observeDecisionSupersedeChainLength(length: number): void {
    if (length < 0) return;
    this.decisionSupersedeChainLength.observe(length);
  }

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

  observeKcFactSupersedeLatencyMs(ms: number): void {
    if (ms < 0) return;
    this.kcFactSupersedeLatencyMs.observe(ms);
  }

  incKcEntityResolvePath(args: {
    path: 'exact' | 'knn' | 'create' | 'cache_hit' | 'strong_id';
  }): void {
    this.kcEntityResolvePathTotal.inc({ path: args.path });
  }

  observeKcEntityResolveLatencyMs(ms: number): void {
    if (ms < 0) return;
    this.kcEntityResolveLatencyMs.observe(ms);
  }

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

  observeKcProjectionRebuildLagMs(ms: number): void {
    if (ms < 0) return;
    this.kcProjectionRebuildLagMs.observe(ms);
  }

  observeKnowledgeCloneCategoriesPerProfile(count: number): void {
    if (count < 0) return;
    this.knowledgeCloneCategoriesPerProfile.observe(count);
  }

  observeKnowledgeCloneProfileSizeKb(kb: number): void {
    if (kb < 0) return;
    this.knowledgeCloneProfileSizeKb.observe(kb);
  }

  setInsightsDynamicLabelCount(args: {
    label: 'growing' | 'stable' | 'declining' | 'spike';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.insightsDynamicLabelCount.set({ label: args.label }, args.value);
  }

  setExperimentsTotal(args: { tenantTop: string; status: string; value: number }): void {
    if (args.value < 0) return;
    this.experimentsTotal.set({ tenant_top: args.tenantTop, status: args.status }, args.value);
  }

  observeExperimentRunningDurationDays(args: { tenantTop: string; days: number }): void {
    if (args.days < 0) return;
    this.experimentsRunningDurationDays.observe({ tenant_top: args.tenantTop }, args.days);
  }

  incExperimentLessonsExtracted(args: { tenantTop: string; count: number }): void {
    if (args.count <= 0) return;
    this.experimentsLessonsExtractedTotal.inc({ tenant_top: args.tenantTop }, args.count);
  }

  incExperimentDetectorRun(args: {
    tenantTop: string;
    result: 'created' | 'updated' | 'skipped' | 'error';
  }): void {
    this.experimentDetectorRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  incProbeEvent(args: { emittedByService: string; reason: string; status: string }): void {
    this.probeEventsTotal.inc({
      emitted_by_service: args.emittedByService,
      reason: args.reason,
      status: args.status,
    });
  }

  incProbeDispatched(args: { kind: string }): void {
    this.probeDispatchedTotal.inc({ kind: args.kind });
  }

  incProbeResponse(args: { eventType: string; kind: string }): void {
    this.probeResponseTotal.inc({
      event_type: args.eventType,
      kind: args.kind,
    });
  }

  observeProbeResponseTime(args: { eventType: string; kind: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.probeResponseTimeSeconds.observe(
      { event_type: args.eventType, kind: args.kind },
      args.seconds,
    );
  }

  incProbeDedupDropped(args: { reason: string }): void {
    this.probeDedupDroppedTotal.inc({ reason: args.reason });
  }

  incProbeRateLimitDropped(): void {
    this.probeRateLimitDroppedTotal.inc();
  }

  incProbeColdStartDropped(): void {
    this.probeColdStartDroppedTotal.inc();
  }

  incOwnerResolution(args: { outcome: 'auto' | 'ambiguous' | 'none' }): void {
    this.ownerResolutionTotal.inc({ outcome: args.outcome });
  }

  incAssistantTurn(args: {
    outcome: 'ok' | 'error' | 'quota' | 'confirm_hold' | 'handler_error';
  }): void {
    this.assistantTurnTotal.inc({ outcome: args.outcome });
  }

  incProbeExpired(): void {
    this.probeExpiredTotal.inc();
  }

  incProbeClosed(args: { tenantTop: string; source: string }): void {
    this.probeClosedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
    });
  }

  setProbeRecipientEngagementRate(args: { userId: string; rate: number }): void {
    if (args.rate < 0) return;
    this.probeRecipientEngagementRate.set({ user_id: args.userId }, args.rate);
  }

  incProbeResponseClassified(args: { confidence_bucket: 'high' | 'medium' | 'low' }): void {
    this.probeResponseClassifiedTotal.inc({
      confidence_bucket: args.confidence_bucket,
    });
  }

  incProbeResponseUnclear(args: { originalReason: string }): void {
    this.probeResponseUnclearTotal.inc({
      original_reason: args.originalReason,
    });
  }

  incProbeOutcome(args: { outcome: 'answered' | 'ignored'; reason: string }): void {
    this.probeOutcomeTotal.inc({ outcome: args.outcome, reason: args.reason });
  }

  incPromptFeedback(args: { promptKey: string; hasEdit: 'true' | 'false' }): void {
    this.promptFeedbackTotal.inc({
      prompt_key: args.promptKey,
      has_edit: args.hasEdit,
    });
  }

  incAutoruleExtracted(args: { promptKey: string; ruleType: string }): void {
    this.autoruleExtractedTotal.inc({
      prompt_key: args.promptKey,
      rule_type: args.ruleType,
    });
  }

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

  incAutoruleOverridden(args: { promptKey: string }): void {
    this.autoruleOverriddenTotal.inc({ prompt_key: args.promptKey });
  }

  incConciergePrmAgreement(args: { agreed: 'true' | 'false' }): void {
    this.conciergePrmAgreementTotal.inc({ agreed: args.agreed });
  }

  incConciergePrmLlmRank(args: { rank: '1' | '2' | '3' | 'other' }): void {
    this.conciergePrmLlmChoseRankTotal.inc({ rank: args.rank });
  }

  incConciergePrmCost(args: { tenantTop: string; costUsd: number }): void {
    if (!Number.isFinite(args.costUsd) || args.costUsd < 0) return;
    this.conciergePrmCostUsdTotal.inc({ tenant_top: args.tenantTop }, args.costUsd);
  }

  observeConciergePrmScore(args: { toolName: string; score: number }): void {
    if (!Number.isFinite(args.score)) return;
    const clamped = Math.min(Math.max(args.score, 0), 1);
    this.conciergePrmScoreDistribution.observe({ tool_name: args.toolName.slice(0, 64) }, clamped);
  }

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

  incPracticeSkillsExtracted(args: { scope: 'person' | 'role' | 'org' }): void {
    this.practiceSkillsExtractedTotal.inc({ scope: args.scope });
  }

  incPracticeSkillsPromoted(): void {
    this.practiceSkillsPromotedTotal.inc();
  }

  incPracticeSkillsArchived(): void {
    this.practiceSkillsArchivedTotal.inc();
  }

  incPracticeSkillsRun(args: { status: 'shadow' | 'active' }): void {
    this.practiceSkillsRunsTotal.inc({ status: args.status });
  }

  observePracticeSkillsCompositeVsBaseline(args: { delta: number }): void {
    if (!Number.isFinite(args.delta)) return;
    const clamped = Math.min(Math.max(args.delta, -1), 1);
    this.practiceSkillsCompositeVsBaseline.observe(clamped);
  }

  incPracticeSkillsRetrievalHit(args: { scope: 'person' | 'role' | 'org' }): void {
    this.practiceSkillsRetrievalHitTotal.inc({ scope: args.scope });
  }

  incGepaOptimization(args: {
    promptKey: string;
    status: 'success' | 'failed' | 'timeout' | 'skipped_no_python';
  }): void {
    this.gepaOptimizationsTotal.inc({
      prompt_key: args.promptKey,
      status: args.status,
    });
  }

  setGepaCandidatesTotal(args: { promptKey: string; status: string; value: number }): void {
    if (args.value < 0) return;
    this.gepaCandidatesTotal.set({ prompt_key: args.promptKey, status: args.status }, args.value);
  }

  incGepaPromoted(args: { promptKey: string }): void {
    this.gepaPromotedTotal.inc({ prompt_key: args.promptKey });
  }

  incGepaRejected(args: { reason: string }): void {
    this.gepaRejectedTotal.inc({ reason: args.reason });
  }

  setGepaAbActive(args: { value: number }): void {
    if (args.value < 0) return;
    this.gepaAbActiveTotal.set(args.value);
  }

  incGepaCost(args: { tenantTop: string; costUsd: number }): void {
    if (!Number.isFinite(args.costUsd) || args.costUsd < 0) return;
    this.gepaCostUsdTotal.inc({ tenant_top: args.tenantTop }, args.costUsd);
  }

  incGepaRollback(args: { reason: string }): void {
    this.gepaRollbackTotal.inc({ reason: args.reason });
  }

  incIdeaStatusChangeNotification(args: { newStatus: string }): void {
    this.ideaStatusChangeNotificationsTotal.inc({ new_status: args.newStatus });
  }

  incChatV2Query(args: { mode: string; channelOrigin: string }): void {
    this.chatV2QueriesTotal.inc({
      mode: args.mode,
      channel_origin: args.channelOrigin,
    });
  }

  observeChatV2RetrievalBlocks(args: { mode: string; count: number }): void {
    this.chatV2RetrievalBlocks.observe({ mode: args.mode }, args.count);
  }

  observeChatV2SynthesisDuration(args: { mode: string; seconds: number }): void {
    this.chatV2SynthesisDurationSeconds.observe({ mode: args.mode }, args.seconds);
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

  incChatV2ReasoningChainsAttached(args: { depth: 1 | 2 }): void {
    this.chatV2ReasoningChainsAttachedTotal.inc({
      depth: String(args.depth),
    });
  }

  observeChatV2ContradictingBlocksInContext(count: number): void {
    if (count < 0) return;
    this.chatV2ContradictingBlocksInContext.observe({}, count);
  }

  incAnswerCacheHit(args: { tenantTop: string }): void {
    this.answerCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  incRetrievalCacheHit(args: { tenantTop: string }): void {
    this.retrievalCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  observeDialogProcessingDuration(args: {
    step: 'contextualize' | 'confidence' | 'classify' | 'multi-query' | 'summarize' | 'total';
    seconds: number;
  }): void {
    if (args.seconds < 0) return;
    this.dialogProcessingDurationSeconds.observe({ step: args.step }, args.seconds);
  }

  incConversationSummary(args: { tenantTop: string }): void {
    this.conversationSummaryTotal.inc({ tenant_top: args.tenantTop });
  }

  incDialogConfidenceLow(args: { tenantTop: string }): void {
    this.dialogConfidenceLowTotal.inc({ tenant_top: args.tenantTop });
  }

  setSkillProfilesActiveTotal(count: number): void {
    if (count < 0) return;
    this.skillProfilesActiveTotal.set(count);
  }

  observeSkillTraitsPerProfile(count: number): void {
    if (count < 0) return;
    this.skillTraitsPerProfile.observe(count);
  }

  incSkillTraitsMarkedMisleading(args: { category: string }): void {
    this.skillTraitsMarkedMisleadingTotal.inc({
      category: args.category.slice(0, 200),
    });
  }

  setPersonaActiveTotal(args: { scope: 'person' | 'role'; value: number }): void {
    if (args.value < 0) return;
    this.personaActiveTotal.set({ scope: args.scope }, args.value);
  }

  observePersonaBuildDuration(seconds: number): void {
    if (seconds < 0) return;
    this.personaBuildDurationSeconds.observe(seconds);
  }

  incCloneAsk(args: { scope: 'person' | 'role' }): void {
    this.cloneAskTotal.inc({ scope: args.scope });
  }

  incCloneAskByOwner(): void {
    this.cloneAskByOwnerTotal.inc();
  }

  incCloneAskRefused(args: { reason: string }): void {
    this.cloneAskRefusedTotal.inc({ reason: args.reason.slice(0, 64) });
  }

  setSkillCategoriesTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.skillCategoriesTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  setSkillTraitCategorizedRatio(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.skillTraitCategorizedRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incExecutablePersonaSnapshot(args: {
    tenantTop: string;
    trigger: 'scheduled' | 'threshold' | 'critical' | 'manual' | 'on_demand';
  }): void {
    this.executablePersonaSnapshotsTotal.inc({
      tenant_top: args.tenantTop,
      trigger: args.trigger,
    });
  }

  setExecutablePersonaSnapshotLag(args: { tenantTop: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.executablePersonaSnapshotLagSeconds.set({ tenant_top: args.tenantTop }, args.seconds);
  }

  incPersonaRebuildTriggered(args: { reason: 'trait_delta' | 'max_age' }): void {
    this.personaRebuildTriggeredTotal.inc({ reason: args.reason });
  }

  setSkillTraitConceptsTotal(args: {
    status: 'active' | 'merged_into' | 'archived';
    value: number;
  }): void {
    if (args.value < 0) return;
    this.skillTraitConceptsTotal.set({ status: args.status }, args.value);
  }

  incSkillTraitConceptsMerged(): void {
    this.skillTraitConceptsMergedTotal.inc();
  }

  incRolePrincipleSynthesized(args: { outcome: 'created' | 'merged' | 'rejected_guard' }): void {
    this.rolePrinciplesSynthesizedTotal.inc({ outcome: args.outcome });
  }

  setRolePrinciplesActiveTotal(value: number): void {
    if (value < 0) return;
    this.rolePrinciplesActiveTotal.set(value);
  }

  observePersonaLayerScore(args: { variant: 'v1' | 'v2'; score: number }): void {
    if (!Number.isFinite(args.score) || args.score < 0 || args.score > 1) {
      return;
    }
    this.clonePersonaLayerScore.observe({ variant: args.variant }, args.score);
  }

  incPersonaLayerValidationCase(args: { outcome: 'judged' | 'skipped' }): void {
    this.personaLayerValidationCasesTotal.inc({ outcome: args.outcome });
  }

  incCloneRoleVersionCreated(args: { roleId: string }): void {
    this.cloneRoleVersionCreatedTotal.inc({ role_id: args.roleId });
  }

  setCloneRoleVersionsTotal(args: { roleId: string; value: number }): void {
    if (args.value < 0) return;
    this.cloneRoleVersionsTotal.set({ role_id: args.roleId }, args.value);
  }

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

  setDomainsTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.domainsTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  setDepartmentsTotal(args: { tenantTop: string; value: number }): void {
    if (args.value < 0) return;
    this.departmentsTotal.set({ tenant_top: args.tenantTop }, args.value);
  }

  setCompanyProfileCompleteness(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.companyProfileCompleteness.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incDomainExpanderCreated(args: { tenantTop: string; count: number }): void {
    if (args.count <= 0) return;
    this.domainExpanderCreatedTotal.inc({ tenant_top: args.tenantTop }, args.count);
  }

  startMaturityScorerTimer(args: { scope: string }): () => void {
    return this.maturityScorerDurationSeconds.startTimer({ scope: args.scope });
  }

  setAppointmentsTotal(args: { tenantTop: string; status: string; value: number }): void {
    if (args.value < 0) return;
    this.appointmentsTotal.set({ tenant_top: args.tenantTop, status: args.status }, args.value);
  }

  incKpiMeasurement(args: { tenantTop: string }): void {
    this.kpiMeasurementsTotal.inc({ tenant_top: args.tenantTop });
  }

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

  setPersonRoleToAppointmentMigrationProgress(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.personRoleToAppointmentMigrationProgress.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  setBrandVoiceProfileCompleteness(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.brandVoiceProfileCompleteness.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incBrandVoiceExtractorRun(args: { tenantTop: string; result: string }): void {
    this.brandVoiceExtractorRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  setBrandVoiceCorpusSize(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.brandVoiceCorpusSize.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  incAxisLabel(args: { tenantTop: string; axis: string; source: string }): void {
    this.axisLabelsTotal.inc({
      tenant_top: args.tenantTop,
      axis: args.axis,
      source: args.source,
    });
  }

  incRouterFallbackCall(args: {
    tenantTop: string;
    result: 'matched' | 'no_match' | 'llm_error';
  }): void {
    this.routerFallbackCallsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  incRouterFallbackCacheHit(args: { tenantTop: string }): void {
    this.routerFallbackCacheHitTotal.inc({ tenant_top: args.tenantTop });
  }

  observeAxisClassifyDuration(args: { axis: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.axisClassifyDurationSeconds.observe({ axis: args.axis }, args.seconds);
  }

  setRoleMapCompletenessAvg(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.roleMapCompletenessAvg.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incRoleMapBuilderRun(args: { tenantTop: string; result: string }): void {
    this.roleMapBuilderRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  startRoleMapExtractTimer(): () => void {
    return this.roleMapExtractDurationSeconds.startTimer();
  }

  setRolesWithNormalizedDataRatio(args: { tenantTop: string; value: number }): void {
    if (Number.isNaN(args.value)) return;
    this.rolesWithNormalizedDataRatio.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  incDailyCheckinCompleted(args: { tenantTop: string; kind: 'morning' | 'evening' }): void {
    this.dailyCheckinsCompletedTotal.inc({
      tenant_top: args.tenantTop,
      kind: args.kind,
    });
  }

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

  setTeamFrictionsTotal(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.teamFrictionsTotal.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  incGoalCascadeMisses(args: { tenantTop: string; count?: number }): void {
    const inc = args.count ?? 1;
    if (inc <= 0) return;
    this.goalCascadeMissesTotal.inc({ tenant_top: args.tenantTop }, inc);
  }

  incPersonalRelationBuilderRun(args: { tenantTop: string; result: string }): void {
    this.personalRelationBuilderRunsTotal.inc({
      tenant_top: args.tenantTop,
      result: args.result,
    });
  }

  incDashboardValueStripServed(args: { tenantTop: string }): void {
    this.dashboardValueStripServedTotal.inc({ tenant_top: args.tenantTop });
  }

  setDashboardMainFirstScreenWidgetCount(args: { tenantTop: string; count: number }): void {
    if (!Number.isFinite(args.count)) return;
    this.dashboardMainFirstScreenWidgetCount.set({ tenant_top: args.tenantTop }, args.count);
  }

  recordWeeklyPerPersonCompute(args: { tenantTop: string; noAnswerTotal: number }): void {
    if (Number.isFinite(args.noAnswerTotal) && args.noAnswerTotal > 0) {
      this.weeklyPerPersonNoAnswerTotal.inc({ tenant_top: args.tenantTop }, args.noAnswerTotal);
    }
  }

  incWeeklyPerPersonSelfViewServed(args: { tenantTop: string }): void {
    this.weeklyPerPersonSelfViewServedTotal.inc({ tenant_top: args.tenantTop });
  }

  incMyIdeasFateServed(args: { tenantTop: string }): void {
    this.myIdeasFateServedTotal.inc({ tenant_top: args.tenantTop });
  }

  incMyRecognitionsServed(args: { tenantTop: string }): void {
    this.myRecognitionsServedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCooSentimentAnalyzed(args: {
    tenantTop: string;
    sentiment: 'green' | 'yellow' | 'red';
  }): void {
    this.cooSentimentAnalyzedTotal.inc({
      tenant_top: args.tenantTop,
      sentiment: args.sentiment,
    });
  }

  incCooSentimentFailed(args: { tenantTop: string; reason?: 'invalid_element' | 'other' }): void {
    this.cooSentimentFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason ?? 'other',
    });
  }

  incCheckinGraphIngest(args: { result: 'ok' | 'skipped' | 'error' }): void {
    this.checkinGraphIngestTotal.inc({ result: args.result });
  }

  incCooWeeklyDigestGenerated(args: { tenantTop: string }): void {
    this.cooWeeklyDigestGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCooWeeklyDigestFailed(args: { tenantTop: string; reason: string }): void {
    this.cooWeeklyDigestFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  setCooTeamTemperatureRedShare(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooTeamTemperatureRedShare.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  setCooBlockersResolved(args: { tenantTop: string; count: number }): void {
    if (!Number.isFinite(args.count)) return;
    this.cooBlockersResolvedTotal.set({ tenant_top: args.tenantTop }, Math.max(0, args.count));
  }

  incCooTeamCapacityWidgetServed(args: { tenantTop: string }): void {
    this.cooTeamCapacityWidgetServedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCooDailyDigestGenerated(args: { tenantTop: string }): void {
    this.cooDailyDigestGeneratedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCooDailyDigestFailed(args: { tenantTop: string; reason: string }): void {
    this.cooDailyDigestFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  incCooDailyDigestDelivered(args: { tenantTop: string; channel: string }): void {
    this.cooDailyDigestDeliveredTotal.inc({
      tenant_top: args.tenantTop,
      channel: args.channel,
    });
  }

  setCooDailyDigestAge(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooDailyDigestAgeSeconds.set({ tenant_top: args.tenantTop }, Math.max(0, args.value));
  }

  setCommitmentAuthorCoverageRatio(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.commitmentAuthorCoverageRatio.set(
      { tenant_top: args.tenantTop },
      Math.min(1, Math.max(0, args.value)),
    );
  }

  incProbeSuggested(args: { trigger: string }): void {
    this.probeSuggestedTotal.inc({ trigger: args.trigger });
  }

  setCooInsightsByCause(args: { tenantTop: string; cause: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooInsightsByCauseTotal.set(
      { tenant_top: args.tenantTop, cause: args.cause },
      Math.max(0, Math.floor(args.value)),
    );
  }

  setCooCompanyMaturityScore(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.cooCompanyMaturityScore.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.min(1, args.value)),
    );
  }

  setCommitmentsOpenTotal(args: { tenantTop: string; value: number }): void {
    if (!Number.isFinite(args.value)) return;
    this.commitmentsOpenTotal.set(
      { tenant_top: args.tenantTop },
      Math.max(0, Math.floor(args.value)),
    );
  }

  incCommitmentsAsked(args: { tenantTop: string }): void {
    this.commitmentsAskedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCommitmentsFulfilled(args: { tenantTop: string }): void {
    this.commitmentsFulfilledTotal.inc({ tenant_top: args.tenantTop });
  }

  incCommitmentsMissed(args: { tenantTop: string }): void {
    this.commitmentsMissedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCommitmentsEscalated(args: { tenantTop: string }): void {
    this.commitmentsEscalatedTotal.inc({ tenant_top: args.tenantTop });
  }

  incCommitmentsExtractFailed(args: { tenantTop: string; reason: string }): void {
    this.commitmentsExtractFailedTotal.inc({
      tenant_top: args.tenantTop,
      reason: args.reason,
    });
  }

  incVoiceAsrRequest(args: { tenantTop: string; provider: string }): void {
    this.voiceAsrRequestsTotal.inc({
      tenant_top: args.tenantTop,
      provider: args.provider,
    });
  }

  observeVoiceAsrDuration(args: { provider: string; seconds: number }): void {
    if (!Number.isFinite(args.seconds) || args.seconds < 0) return;
    this.voiceAsrDurationSeconds.observe({ provider: args.provider }, args.seconds);
  }

  incVoiceTtsRequest(args: { tenantTop: string; provider: string }): void {
    this.voiceTtsRequestsTotal.inc({
      tenant_top: args.tenantTop,
      provider: args.provider,
    });
  }

  addVoiceTtsChars(args: { tenantTop: string; chars: number }): void {
    if (!Number.isFinite(args.chars) || args.chars <= 0) return;
    this.voiceTtsCharsTotal.inc({ tenant_top: args.tenantTop }, Math.floor(args.chars));
  }

  incVoiceWsSession(outcome: 'completed' | 'cancelled' | 'error' | 'timeout'): void {
    this.voiceWsSessionTotal.inc({ outcome });
  }

  incVoiceWsChunk(): void {
    this.voiceWsChunkTotal.inc();
  }

  observeVoiceWsAsrLatency(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.voiceWsAsrLatencyMs.observe(ms);
  }

  incConciergeMessage(args: { tenantTop: string }): void {
    this.conciergeMessagesTotal.inc({ tenant_top: args.tenantTop });
  }

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

  incConciergeUndo(args: { tenantTop: string; tool: string }): void {
    this.conciergeUndoTotal.inc({
      tenant_top: args.tenantTop,
      tool: args.tool,
    });
  }

  incConciergeQuotaExceeded(args: { tenantTop: string; scope: 'daily' | 'monthly' }): void {
    this.conciergeQuotaExceededTotal.inc({
      tenant_top: args.tenantTop,
      scope: args.scope,
    });
  }

  incConciergeDialogLayerUsed(args: { intent: string }): void {
    this.conciergeDialogLayerUsedTotal.inc({ intent: args.intent.slice(0, 32) });
  }

  incConciergeCacheHit(): void {
    this.conciergeCacheHitTotal.inc();
  }

  observeConciergePreRetrievalHits(count: number): void {
    if (!Number.isFinite(count) || count < 0) return;
    this.conciergePreRetrievalHitsCount.observe(count);
  }

  incOrchestratorRun(args: { status: 'done' | 'failed' | 'timeout' | 'cancelled' }): void {
    this.orchestratorRunsTotal.inc({ status: args.status });
  }

  incOrchestratorSubagent(args: {
    agentType: string;
    result: 'done' | 'failed' | 'low_confidence';
  }): void {
    this.orchestratorSubagentsTotal.inc({
      agent_type: args.agentType,
      result: args.result,
    });
  }

  observeOrchestratorRunDurationSeconds(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.orchestratorRunDurationSeconds.observe(seconds);
  }

  incOrchestratorVerificationLowConfidence(): void {
    this.orchestratorVerificationLowConfidenceTotal.inc();
  }

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

  setOrgBudgetUtilizationPercent(args: { tenantTop: string; percent: number }): void {
    if (!Number.isFinite(args.percent) || args.percent < 0) return;
    this.orgBudgetUtilizationPercent.set({ tenant_top: args.tenantTop }, args.percent);
  }

  setProviderSmokeTestSuccess(args: { provider: string; success: boolean }): void {
    this.providerSmokeTestSuccess.set({ provider: args.provider }, args.success ? 1 : 0);
  }

  observeProviderSmokeTestDuration(args: { provider: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.providerSmokeTestDurationSeconds.observe({ provider: args.provider }, args.seconds);
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

  incProactiveEmitted(args: { rule: string; severity: 'low' | 'medium' | 'high' }): void {
    this.proactiveNotificationsEmittedTotal.inc({
      rule: args.rule,
      severity: args.severity,
    });
  }

  incProactiveDismissed(args: { rule: string }): void {
    this.proactiveNotificationsDismissedTotal.inc({ rule: args.rule });
  }

  incProactiveDedupSkipped(): void {
    this.proactiveNotificationsDedupSkippedTotal.inc();
  }

  observeProactiveRuleDuration(args: { rule: string; seconds: number }): void {
    if (args.seconds < 0) return;
    this.proactiveWatcherDurationSeconds.observe({ rule: args.rule }, args.seconds);
  }

  incIssueCreated(args: { tenant: string; project: string; source: string }): void {
    this.issuesCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
      source: args.source,
    });
  }

  incIssueCompleted(args: { tenant: string; project: string }): void {
    this.issuesCompletedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incSubtaskCreated(args: { tenant: string; project: string }): void {
    this.subtasksCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incChecklistCreated(args: { tenant: string; project: string }): void {
    this.checklistsCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incChecklistItemAdded(args: { tenant: string; project: string; viaBulk: boolean }): void {
    this.checklistItemsAddedTotal.inc({
      tenant: args.tenant,
      project: args.project,
      via_bulk: args.viaBulk ? 'true' : 'false',
    });
  }

  incChecklistItemCompleted(args: { tenant: string; project: string }): void {
    this.checklistItemsCompletedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incProjectDocumentCreated(args: { tenant: string; project: string }): void {
    this.projectDocumentsCreatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incProjectDocumentUpdated(args: { tenant: string; project: string }): void {
    this.projectDocumentsUpdatedTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incLinkedCardsView(args: { tenant: string; project: string }): void {
    this.linkedCardsViewTotal.inc({
      tenant: args.tenant,
      project: args.project,
    });
  }

  incIntakeTriaged(args: { tenant: string; decision: string }): void {
    this.intakeTriagedTotal.inc({
      tenant: args.tenant,
      decision: args.decision,
    });
  }

  incTrackerWebhookDelivery(args: { tenant: string; event: string; success: boolean }): void {
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

  incTrackerEventToKnowledgeCore(args: { tenant: string; type: string }): void {
    this.trackerEventsToKnowledgeCoreTotal.inc({
      tenant: args.tenant,
      type: args.type,
    });
  }

  incTrackerIssueEmbed(args: { tenantTop: string; status: 'ok' | 'skipped' | 'failed' }): void {
    this.trackerIssueEmbedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
    });
  }

  incTrackerIssueSimilarSearch(args: { tenantTop: string }): void {
    this.trackerIssueSimilarSearchTotal.inc({ tenant_top: args.tenantTop });
  }

  incAiIssueInferred(args: { tenantTop: string; accepted: 'true' | 'false' }): void {
    this.aiIssueInferredTotal.inc({
      tenant_top: args.tenantTop,
      accepted: args.accepted,
    });
  }

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

  incAiMeetingActionsExtracted(args: {
    tenantTop: string;
    status: 'created' | 'skipped_idempotent' | 'llm_empty' | 'llm_error';
    by?: number;
  }): void {
    this.aiMeetingActionsExtractedTotal.inc(
      { tenant_top: args.tenantTop, status: args.status },
      args.by ?? 1,
    );
  }

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

  incAiIntakeSuggested(args: {
    tenantTop: string;
    status: 'auto_accepted' | 'pending' | 'llm_error' | 'skipped_already_triaged';
    source: string;
  }): void {
    this.aiIntakeSuggestedTotal.inc({
      tenant_top: args.tenantTop,
      status: args.status,
      source: args.source,
    });
  }

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

  setIssuesOverdueCount(args: { tenant: string; project: string; count: number }): void {
    this.issuesOverdueCount.set({ tenant: args.tenant, project: args.project }, args.count);
  }

  setIntakePendingCount(args: { tenant: string; count: number }): void {
    this.intakePendingCount.set({ tenant: args.tenant }, args.count);
  }

  incTeamTemplateUsed(args: { tenantTop: string; slug: string }): void {
    this.teamTemplateUsedTotal.inc({
      tenant_top: args.tenantTop,
      slug: args.slug,
    });
  }

  incHolidayDueDateAdjusted(args: { tenantTop: string }): void {
    this.holidayDueDateAdjustedTotal.inc({ tenant_top: args.tenantTop });
  }

  incBoardCreated(args: { tenantTop: string; project: string }): void {
    this.boardsCreatedTotal.inc({
      tenant_top: args.tenantTop,
      project: args.project,
    });
  }

  incBoardArchived(args: { tenantTop: string; project: string }): void {
    this.boardsArchivedTotal.inc({
      tenant_top: args.tenantTop,
      project: args.project,
    });
  }

  incBoardIssueMoved(args: { tenantTop: string; fromBoard: string; toBoard: string }): void {
    this.boardIssuesMovedTotal.inc({
      tenant_top: args.tenantTop,
      from_board: args.fromBoard,
      to_board: args.toBoard,
    });
  }

  incIssueMovedToProject(args: { tenantTop: string }): void {
    this.issueMovedToProjectTotal.inc({ tenant_top: args.tenantTop });
  }

  incMailInboundReceived(args: {
    projectId: string;
    status: 'received' | 'bounced' | 'failed' | 'created';
  }): void {
    this.mailInboundReceivedTotal.inc({
      project_id: args.projectId,
      status: args.status,
    });
  }

  incMailInboundIssueCreated(): void {
    this.mailInboundIssuesCreatedTotal.inc();
  }

  incMailInboundBounce(args: { reason: string }): void {
    this.mailInboundBounceTotal.inc({ reason: args.reason });
  }

  incMailInboundAttachmentUploaded(): void {
    this.mailInboundAttachmentUploadedTotal.inc();
  }

  incProbeGoalAlignmentLowEmitted(args: { tenantTop: string }): void {
    this.probeGoalAlignmentLowEmittedTotal.inc({ tenant_top: args.tenantTop });
  }

  incImportStarted(args: {
    tenantTop: string;
    source: 'trello' | 'bitrix24' | 'yandex_tracker';
  }): void {
    this.importStartedTotal.inc({
      tenant_top: args.tenantTop,
      source: args.source,
    });
  }

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

  incFeedItemEmitted(args: { tenant: string; feedType: string; severity: string }): void {
    this.feedItemsEmittedTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      severity: args.severity,
    });
  }

  incFeedItemActioned(args: { tenant: string; feedType: string; status: string }): void {
    this.feedItemsActionedTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      status: args.status,
    });
  }

  incFeedReaction(args: { tenant: string; feedType: string; reaction: string }): void {
    this.feedReactionsTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
      reaction: args.reaction,
    });
  }

  incFeedItemExpired(args: { tenant: string; feedType: string }): void {
    this.feedItemsExpiredTotal.inc({
      tenant: args.tenant,
      feed_type: args.feedType,
    });
  }

  incCalendarEventCreated(args: { tenant: string; kind: string; visibility: string }): void {
    this.calendarEventsCreatedTotal.inc({
      tenant: args.tenant,
      kind: args.kind,
      visibility: args.visibility,
    });
  }

  incCalendarReminderSent(args: { tenant: string; channel: string; success: boolean }): void {
    this.calendarRemindersSentTotal.inc({
      tenant: args.tenant,
      channel: args.channel,
      success: args.success ? 'true' : 'false',
    });
  }

  incCalendarFindFreeSlot(args: { tenant: string; found: boolean }): void {
    this.calendarFindFreeSlotTotal.inc({
      tenant: args.tenant,
      found: args.found ? 'true' : 'false',
    });
  }

  incFeedbackDigestRun(args: {
    result: 'success' | 'skipped' | 'lock_held' | 'agent_failed' | 'txn_failed' | 'anomaly';
  }): void {
    this.feedbackDigestRunsTotal.inc({ result: args.result });
  }

  incFeedbackDigestMessagesProcessed(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestMessagesProcessedTotal.inc(by);
  }

  incFeedbackDigestNewTopics(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestNewTopicsTotal.inc(by);
  }

  incFeedbackDigestFailedRuns(by: number): void {
    if (by <= 0) return;
    this.feedbackDigestFailedRunsTotal.inc(by);
  }

  incTourStarted(args: { tenant: string; tour_id: string }): void {
    this.tourStartedTotal.inc({ tenant: args.tenant, tour_id: args.tour_id });
  }

  incTourCompleted(args: { tenant: string; tour_id: string }): void {
    this.tourCompletedTotal.inc({
      tenant: args.tenant,
      tour_id: args.tour_id,
    });
  }

  incTourSkipped(args: { tenant: string; tour_id: string; at_step: string }): void {
    this.tourSkippedTotal.inc({
      tenant: args.tenant,
      tour_id: args.tour_id,
      at_step: args.at_step,
    });
  }

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

  incSprintHelperRun(args: { tenant: string; status: 'success' | 'failed' | 'skipped' }): void {
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

  observeSprintReviewGenerationDuration(args: { tenant: string; seconds: number }): void {
    this.sprintReviewGenerationDurationSeconds.observe({ tenant: args.tenant }, args.seconds);
  }

  incTemporalEdgesInvalidated(args: { relationType: string }): void {
    this.temporalEdgesInvalidatedTotal.inc({
      relationType: args.relationType,
    });
  }

  incTemporalFilterHit(args: { result: 'passed' | 'filtered_out' }): void {
    this.temporalFilterHitsTotal.inc({ result: args.result });
  }

  setEdgesWithTemporal(args: { type: 'block' | 'entity'; value: number }): void {
    this.edgesWithTemporalTotal.set({ type: args.type }, args.value);
  }

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

  incDebateCost(args: { tenantTop: string; taskType: string; costUsd: number }): void {
    if (args.costUsd <= 0) return;
    this.debateCostUsdTotal.inc(
      { tenant_top: args.tenantTop, task_type: args.taskType },
      args.costUsd,
    );
  }

  incDebateRound2Triggered(args: { taskType: string }): void {
    this.debateRound2TriggeredTotal.inc({ task_type: args.taskType });
  }

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

  incDebateFallbackToSingle(args: { reason: 'cost_cap' | 'provider_unavailable' }): void {
    this.debateFallbackToSingleTotal.inc({ reason: args.reason });
  }

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
