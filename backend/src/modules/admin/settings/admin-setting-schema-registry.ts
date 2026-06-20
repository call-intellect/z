import { z, type ZodTypeAny } from 'zod';

export const MIN_REASON_LENGTH = 10;

const POSITIVE_INT = z.number().int().positive();
const NON_NEGATIVE_INT = z.number().int().nonnegative();
const UNIT_INTERVAL = z.number().min(0).max(1);

const registry = new Map<string, ZodTypeAny>([
  ['knowledge.distillMergeThreshold', UNIT_INTERVAL],
  ['knowledge.entityMergeThreshold', UNIT_INTERVAL],
  ['knowledge.themeCosineThreshold', UNIT_INTERVAL],
  ['knowledge.ideaClusterThreshold', UNIT_INTERVAL],
  ['knowledge.insightClusterThreshold', UNIT_INTERVAL],
  ['knowledge.searchCosineWeight', UNIT_INTERVAL],
  ['knowledge.searchBm25Weight', UNIT_INTERVAL],
  ['knowledge.linkMinConfidence', UNIT_INTERVAL],
  ['knowledge.skillTraitSimilarityThreshold', UNIT_INTERVAL],
  ['knowledge.curationAutoThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationDeepReviewThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationStaleDynamicScoreThreshold', UNIT_INTERVAL],
  ['knowledge.reportBlockConfidenceCap', UNIT_INTERVAL],
  ['knowledge.curationProvisionalThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationAuditSampleRate', UNIT_INTERVAL],
  ['knowledge.curationThresholdMin', UNIT_INTERVAL],
  ['knowledge.curationThresholdMax', UNIT_INTERVAL],
  ['knowledge.curationAutotuneStep', UNIT_INTERVAL],
  ['knowledge.curationMaxProvisionalOverride', UNIT_INTERVAL],
  ['knowledge.insightSpikeRatio', z.number().min(0).max(100)],

  ['knowledge.distillDebounceMs', POSITIVE_INT],
  ['knowledge.distillKnnTopK', POSITIVE_INT],
  ['knowledge.regulationDedupeTopK', POSITIVE_INT],
  ['knowledge.blockIngestWindowSegments', POSITIVE_INT],
  ['knowledge.blockIngestMaxTokensPerSegment', POSITIVE_INT],
  ['knowledge.linkerMinBlocks', POSITIVE_INT],
  ['knowledge.linkKnnTopK', POSITIVE_INT],
  ['knowledge.blockDynamicScoreDecayDays', POSITIVE_INT],
  ['knowledge.entityGraphMinComentions', POSITIVE_INT],
  ['knowledge.themeClusteringMinBlocks', POSITIVE_INT],
  ['knowledge.themeClusterMinSize', POSITIVE_INT],
  ['knowledge.cardRollupV2DebounceMs', POSITIVE_INT],
  ['knowledge.meetingAnalyzeV2DebounceMs', POSITIVE_INT],
  ['knowledge.chatV2TopBlocks', POSITIVE_INT],
  ['knowledge.chatV2GraphHops', POSITIVE_INT],
  ['knowledge.chatV2SynthesisTimeoutMs', POSITIVE_INT],
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
  ['knowledge.curationAutotuneEnabled', z.boolean()],
  ['knowledge.subjectAttributionEnabled', z.boolean()],
  ['knowledge.subjectAttributionAllTypes', z.boolean()],
  ['knowledge.meetingTasksToTrackerOnly', z.boolean()],
  ['knowledge.ideaDirectPathEnabled', z.boolean()],

  ['meetings.taskDedupeEnabled', z.boolean()],
  ['meetings.taskDedupeThreshold', UNIT_INTERVAL],

  ['graph.ageEnabled', z.boolean()],

  ['aiFeatures.summaryAgentEnabled', z.boolean()],
  ['aiFeatures.regulationMinMaterializeConfidence', UNIT_INTERVAL],
  ['aiFeatures.regulationConsolidatorEnabled', z.boolean()],
  ['aiFeatures.clientProtocolEnabled', z.boolean()],

  ['llm.cacheSmokeEnabled', z.boolean()],
  ['llm.cacheHitRatioWarnThreshold', UNIT_INTERVAL],

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
  ['table.agent.max_concurrent_enrich_jobs_per_org', POSITIVE_INT],
  ['table.agent.max_daily_tokens', POSITIVE_INT],

  ['table.import.dedup_threshold', UNIT_INTERVAL],

  ['tracker.autoAcceptConfidenceThreshold', UNIT_INTERVAL],

  ['goals.pulse.enabled', z.boolean()],
  ['goals.pulse.deliver_to_telegram', z.boolean()],

  ['goals.themeAutolinkMinWeight', UNIT_INTERVAL],
  ['goals.themeAutolinkLlmEnabled', z.boolean()],

  ['goals.goalTaskLinkEnabled', z.boolean()],

  ['goals.author_coverage_min', UNIT_INTERVAL],
  ['reliability.min_denominator', POSITIVE_INT],
  ['provenance.confidence_review_threshold', UNIT_INTERVAL],
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
  // Probe Фаза 2 (2026-06-17) — kill-switch LLM-судьи качества формулировки
  // probe-вопроса (один регенерат при браке). ON.
  ['probe.qualityJudgeEnabled', z.boolean()],
  // Probe Фаза 3 (2026-06-17) — kill-switch выбора получателя probe по
  // engagement-снимку (самый отзывчивый из кандидатов). ON.
  ['probe.engagementRoutingEnabled', z.boolean()],
  // Probe Фаза 4 (2026-06-17) — семантический дедуп близких по смыслу probe
  // по эмбеддингу вопроса (рубильник ON · cosine-порог · окно поиска в часах).
  ['probe.semanticDedupEnabled', z.boolean()],
  ['probe.semanticDedupThreshold', UNIT_INTERVAL],
  ['probe.semanticDedupWindowHours', POSITIVE_INT],
  // Probe Фаза 5 (2026-06-17) — kill-switch одного переспроса (re-ask) при
  // истечении неотвеченного probe (переформулировать и спросить ещё раз). ON.
  ['probe.reaskEnabled', z.boolean()],
  ['probe.valueGateEnabled', z.boolean()],
  ['probe.digestFormulateEnabled', z.boolean()],

  ['blocker_synthesis.lookback_days', POSITIVE_INT],
  ['blocker_synthesis.recurring_days', POSITIVE_INT],
  ['blocker_synthesis.impact.base', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.customer', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.deadline', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.commitment', NON_NEGATIVE_INT],
  ['blocker_synthesis.impact.per_day_open', z.number().nonnegative()],
  ['operations.blocker_synthesis.enabled', z.boolean()],

  ['decision.stale_days', POSITIVE_INT],
  ['operations.decision_controller.enabled', z.boolean()],

  ['operations.promise_cascade.enabled', z.boolean()],

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

  ['pendingActions.reminderWindowStartHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderWindowEndHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderStepHours', POSITIVE_INT],
  ['pendingActions.urgentAgeDays', POSITIVE_INT],
  ['pendingActions.reminderLeadDays', POSITIVE_INT],
]);

export function getSchemaForKey(key: string): ZodTypeAny {
  return registry.get(key) ?? z.unknown();
}

export function hasSchemaForKey(key: string): boolean {
  return registry.has(key);
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
