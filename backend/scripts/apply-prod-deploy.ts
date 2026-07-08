type Phase =
  | 'bootstrap-admin'
  | 'seed-llm-core'
  | 'seed-base'
  | 'seed-llm-routes'
  | 'seed-llm-default'
  | 'patch'
  | 'backfill'
  | 'migrate';

interface Step {
  phase: Phase;
  script: string;
  hint?: string;
  args?: string[];
  skipBootstrap?: boolean;
  skipUpdate?: boolean;
  timeoutMs?: number;
  everyDeploy?: boolean;
}

const DEFAULT_STEP_TIMEOUT_MS = Number(
  process.env['DEPLOY_STEP_TIMEOUT_MS'] ?? 600_000,
);

const LEDGER_TABLE = 'public._deploy_applied_step';

function isOnceStep(step: Step): boolean {
  if (step.everyDeploy) return false;
  return (
    step.phase === 'patch' ||
    step.phase === 'backfill' ||
    step.phase === 'migrate' ||
    step.phase === 'seed-llm-routes'
  );
}

async function stepHash(step: Step): Promise<string | null> {
  try {
    const content = await Bun.file(step.script).text();
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(content);
    hasher.update('\0args\0');
    hasher.update((step.args ?? []).join(' '));
    return hasher.digest('hex');
  } catch {
    return null;
  }
}

const STEPS: Step[] = [
  {
    phase: 'bootstrap-admin',
    script: 'prisma/seed.ts',
    hint: 'super-admin из ADMIN_BOOTSTRAP_EMAIL',
    skipUpdate: true,
  },

  { phase: 'seed-llm-core', script: 'scripts/seed-default-llm-providers-and-models.ts' },
  { phase: 'seed-llm-core', script: 'scripts/seed-llm-model-prices.ts' },
  {
    phase: 'seed-llm-core',
    script: 'scripts/seed-prompt-templates.ts',
    hint: '13 системных шаблонов',
  },
  {
    phase: 'seed-llm-core',
    script: 'scripts/seed-llm-task-routes-default.ts',
    hint: 'дефолтные цепочки',
  },
  {
    phase: 'seed-llm-core',
    script: 'scripts/seed-llm-task-routes-month-company.ts',
    hint: 'маршрут operations-monthly-digest (Месяц компании Ф6)',
  },
  {
    phase: 'seed-llm-core',
    script: 'scripts/seed-llm-task-routes-personal-day-narrative.ts',
    hint: 'маршрут personal-day-narrative → deepseek-v4-pro (стабильная json_schema для письма «Твой день»)',
  },
  {
    phase: 'seed-llm-core',
    script: 'scripts/patch-daily-digest-route-deepseek-pro-gpt-kie.ts',
    hint: 'маршрут operations-daily-digest → deepseek-v4-pro → gpt-5.4-mini → kie/gemini-3.1-pro (День компании v2 Ф5); уважает админ-правки, идемпотентно',
  },

  { phase: 'seed-base', script: 'scripts/seed-entitlements.ts' },
  { phase: 'seed-base', script: 'scripts/seed-retention-policies.ts' },
  { phase: 'seed-base', script: 'scripts/seed-holiday-calendar-ru-2026.ts' },
  { phase: 'seed-base', script: 'scripts/seed-team-templates.ts' },
  { phase: 'seed-base', script: 'scripts/seed-functional-domains.ts' },
  { phase: 'seed-base', script: 'scripts/seed-admin-settings.ts' },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-settings-billing.ts',
    hint: '6 ключей billing.* для tier_standard',
  },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-daily-digest.ts' },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-week-month-v2.ts',
    hint: 'operations.weekly_digest.raw_char_budget (Неделя v2 Ф1)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-report-archive.ts',
    hint: 'operations.report_archive.recent_limit (навигатор/архив отчётов день/неделя/месяц)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-month-company.ts',
    hint: 'betaOps.monthlyDigest{Enabled,LocalHour} (Месяц компании Ф6)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-dashboard-main.ts',
    hint: 'dashboard.main_rework.enabled kill-switch (ТЗ-2 Ф1 новая компоновка главной директора)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-goals-pulse.ts',
    hint: 'goals.pulse.{enabled,deliver_to_telegram} (Goals OKR v2 Фаза 4)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-goals-knobs.ts',
    hint: 'goals.* + tracker.goalAlignmentLow* пороги/лимиты (Ф9 крутилки goals-engine)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-theme-autofill.ts',
    hint: 'theme.autofill.* — крутилки авто-наполнения пользовательских тем (living-topic-space Ф3)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-chatbox.ts',
    hint: 'chatbox.session.idle_gap_hours + chatbox.enabled (ChatBox-интеграция)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-notification-budget.ts',
    hint: 'notifications.daily_budget.* + quiet_hours.* + binding_campaign.enabled (TZ-1 Ф0 daily-value)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-customer-risk.ts',
    hint: 'customer_risk.window_days + weight.* + threshold.* + operations.customer_risk_radar.enabled (TZ-1 Ф1 радар клиентов)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-dialog-layer.ts',
    hint: 'dialog_layer.query_history_pairs=4 — глубина истории модуля понимания запроса (ТЗ 2026-06-14 слитый dialog-layer)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-concierge.ts',
    hint: 'concierge.history_pairs + clarify_min_confidence + 12 крутилок/рубильников помощника (enabled/dialogLayer/nativeTools/prm*/лимиты/SSE/pre-retrieval) — config-knobs-to-admin-settings',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-orchestrator.ts',
    hint: 'orchestrator.{enabled(OFF),maxSubagentsPerRun,runTimeoutMinutes} — крутилки оркестратора (config-knobs-to-admin-settings)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-router-fallback.ts',
    hint: 'router.{fallbackNegativeTtlSeconds,llmFallbackEnabled(OFF),fallbackCacheTtlSeconds} — крутилки фолбэка роутера специалистов (config-knobs-to-admin-settings)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-kie-timeout.ts',
    hint: 'ai.kie.timeoutMs=180000 — таймаут вызова провайдера KIE, вынесен из захардкоженных 60_000 (chat-v2-dataclass-routing-fallback Б3)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-chat.ts',
    hint: 'chat_presence_ttl_seconds + chat_outbox_sweep_{stale_seconds,batch_limit} — крутилки presence-TTL и backstop-sweep transactional outbox единого чата (unified-chat Ф1b); external_link_ttl_hours + external_inbound_rate_limit — крутилки внешней переписки (unified-chat Ф3.5); huddle_max_participants — лимит участников созвона из чата (unified-chat Ф7b)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-worker-knobs.ts',
    hint: 'knowledge.axisClassifyEnabled + roleProfiles.minBlocks + curation.consistencyChecker* + curation.completenessScannerEnabled + tracker.goalAlignmentLowEnabled + conversational.telegramDigestHourLocal + recording.trackWatchdog{Enabled,TimeoutMinutes} — крутилки воркеров (config-knobs-to-admin-settings)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-tracker.ts',
    hint: 'tracker.progressAutoDraft{Enabled,MinSignals,Cron} — крутилки воркера авто-черновика прогресса задач (tracker-card-redesign-and-progress Ф7) + tracker.{assigneeClarifyEnabled,dueDateClarifyEnabled,assigneeProbePriorityHint} — дозапрос исполнителя/срока задачи через probe (Блок A Ф1)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-morning-tasks-digest.ts',
    hint: 'tracker.morningDigest.{enabled,hourMsk,channels,maxItemsTotal,sendWhenEmpty} — крутилки утренней сводки открытых задач сотруднику',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-knowledge-extract.ts',
    hint: 'knowledge.{decisions,ideas,insights}ExtractMinConfidence — пороги уверенности извлекателей решений/идей/инсайтов (task-decision-disambiguation Ф5)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-documents.ts',
    hint: 'documents.short_text_to_idea_threshold=200 — порог, при котором короткий вставленный текст предлагается отправить в «Идеи» вместо документа (QA-Ф8 R17)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-proactive.ts',
    hint: 'proactive.{eveningPlanCheckEnabled,planItemOverdueThresholdDays} — вечерняя сверка плана дня по незакрытым пунктам (Блок C Ф3 F7)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-task-closure.ts',
    hint: 'taskClosure.{enabled,matchThreshold,embedTimeoutMs,candidateTtlDays,lexicalFallbackMinOverlap} — крутилки петли авто-закрытия задач (task-loop Ф2b)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-work-hours.ts',
    hint: 'work_hours_default_{start,end} + work_days_default + default_timezone — дефолты рабочего профиля (calendar-master Ф4)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-chat-v2-tables.ts',
    hint: 'chat_v2.table_context_max_rows=20 + max_tables=2 — лимиты параллельной ветки умных таблиц chat_v2 (ТЗ 2026-06-15 §7 ЧАСТЬ B)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-chat-v2-recall.ts',
    hint: 'knowledge.chatV2{GraphAlwaysExpand,FilterMode,FilterBoostWeight,EntityLinkHops,CascadeEnabled,CascadeMinPool,AggregationMode,UnderstandGrounding,GroundingTopK,AdaptiveHops} — 6 рубильников + 4 порога переработки recall «Мастера» (ТЗ 2026-07-02-recall-master-retrieval-redesign)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-recall-to-99.ts',
    hint: 'knowledge.chatV2{AssertiveSynthesis,GroundednessMode,GroundingEmbedding,GroundingEmbeddingTopK,GroundingEmbeddingMinSim,DeterministicPeriod,GraphCypherRecall,GraphCypherMaxDepth} + knowledge.graphReconcile{Enabled,BatchSize} — 10 крутилок ТЗ recall-master-to-99 (ассертивный синтез, эмбеддинг-резолв, детерминизм периода, AGE-в-recall, reconcile)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-personal-brief.ts',
    hint: 'operations.personal_daily_brief.{enabled,morning_hour} + operations.knows_who.enabled + knows_who.min_confidence (TZ-1 Ф2 движок рядового)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-execution-agents.ts',
    hint: 'probe.* (Ф3.D) + blocker_synthesis.* + operations.blocker_synthesis.enabled (TZ-1 Ф3.A/B/C агенты исполнения)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-knowledge-improvement-agents.ts',
    hint: 'ideas.feed.* + insight.recheck_days + team_capacity.{overload,underload}_percent + onboarding.silent_days + 5 kill-switch (ideas.feed/insights.recheck/operations.{knowledge_at_risk,team_capacity,onboarding_ramp}.enabled) (TZ-1 Ф4 улучшения и знания)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-value-recap.ts',
    hint: 'operations.value_recap.enabled + chat_v2.feedback.{enabled,min_rated,retry_dedup_seconds} (TZ-1 Ф5 месячная витрина value-recap)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-operations-dashboard.ts',
    hint: 'operations.dashboard_rework.enabled kill-switch (ТЗ-2 Ф2 новая раскладка COO-дашборда)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-operations-per-person.ts',
    hint: 'operations.per_person_self_view.enabled kill-switch (ТЗ-2 Ф4 self-view /me/weekly-per-person)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-me-widgets.ts',
    hint: 'me.daily_value_widgets.enabled kill-switch (ТЗ-2 Ф5 виджеты /me: /me/ideas + /me/recognitions)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-portfolio-health.ts',
    hint: 'portfolio.health.{threshold_*,weight_*} + operations.portfolio_health.enabled kill-switch (ТЗ-2 Ф6.A здоровье портфеля целей)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-voice-note-retention.ts',
    hint: 'provenance.voiceNoteAudioRetentionDays=90 + voiceNoteAudioPresignTtlSeconds=600 (провенанс Ф B3 «Послушать оригинал»)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-provenance-friction.ts',
    hint: 'provenance.frictionVerbatimRoles=[owner,admin] — роли, видящие дословные реплики конфликта (friction) в дровере «Откуда это»; прочие видят тему+встречу без реплик (drilldown-provenance-parity Ф1)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-document-attribution.ts',
    hint: 'documents.ai_attribution.enabled kill-switch (ТЗ-4 Ф10 LLM-подсказка атрибуции документа: docType + тема)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-knowledge-base-redesign.ts',
    hint: 'knowledge_base.redesign.enabled kill-switch (Ф5 редизайн раздела «База знаний»)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-knowledge-graph.ts',
    hint: 'knowledge.* граф-ингест (Ф3/Ф5/Ф6/Ф7/Ф8: нарезка с overlap, контекст-заголовок, пороги рёбер/судьи, alias-резолв, поиск RRF/обход, theme-summary)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-smart-search.ts',
    hint: 'rag.* (умный поэтапный поиск Мастера Ф4: RRF, реранк, достаточность, гейт честности, cold-start)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-retention-logging.ts',
    hint: 'retention.* (10) + logging.* (11) (config Шаг 5 — крутилки хранения и логов в AdminSetting)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-limits.ts',
    hint: 'limits.* + share.* + aiChatQuota.* + smartTables.* (config Шаг 6 — лимиты и квоты в AdminSetting)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-clone-regulations.ts',
    hint: '4 крутилки clone.regulations.* (retrieval top_n/min_similarity, snapshot max_items, scope include_org) — клон знает регламенты должности (Способ C)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-clone-coverage.ts',
    hint: 'knowledgeClone.profileMinConfidence (0.55) — мягкий порог материализации профиля-клона (F-7): provisional/light ≥ порога сохраняются, deep остаётся на ручной курации',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-clone-construction.ts',
    hint: 'knowledge.skillClusterSimilarityThreshold (0.72) + knowledge.personaRoleAggMinPersons (1) — фикс построения клонов: порог склейки блоков вынесен из захардкоженного 0.78, одиночная должность получает клон роли (clone-construction-fixes)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-probe-curation.ts',
    hint: 'probe.* (10) + knowledge.curation{ItemExpiryDays,StaleMonthsThreshold,StaleDynamicScoreThreshold} (config Шаг 7 — probe + остаток курации в AdminSetting)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-llm-models-and-gray.ts',
    hint: 'ai.{anthropic.model,vox.model,deepseek.defaultModel} + gepa.{reflectionLm,taskLm} + ai.mainReport.primary kill-switch + mail.dryRun + operations.daily_digest.deliver_to_webpush + betaOps.*LocalHour/Day часы дайджестов (config Шаг 8 — GRAY: модели LLM, рубильники, часы)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-embedding-providers.ts',
    hint: '2 провайдера эмбеддингов (local active/openai-via-proxy inactive) в DB, ключи AES-256-GCM',
  },
  { phase: 'seed-base', script: 'scripts/seed-badges.ts' },
  { phase: 'seed-base', script: 'scripts/seed-global-channels.ts' },
  {
    phase: 'seed-base',
    script: 'scripts/seed-integration-crons.ts',
    hint: 'строки CronSchedule для bitrix/chatbox sync+analyze кранов и prune (трекинг истории кронов); create-if-missing, админские правки расписания не трогает',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-knowledge-groups.ts',
    hint: 'группы доступа: Руководство/Совет + department-группы + leadership-членство (Ф2 knowledge-access)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-support-project.ts',
    hint: 'SupportSlaPolicy (60/480) для вендор-Org (TZ support-desk; тикеты на Conversation/Message, не Issue); no-op без support.vendor_org_id',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-support-contour-group.ts',
    hint: 'закрытый контур поддержки KnowledgeGroup(kind=support) (TZ support-desk); no-op без support.vendor_org_id',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-support.ts',
    hint: 'support_critic_min_groundedness=0.6 (R-INV-5) + support_promote_min_csat=4 (TZ support-desk Ф3 гейт промоута R-INV-2)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-entity-consolidate.ts',
    hint: 'knowledge.entityConsolidateSameName{Enabled,BatchSize} — kill-switch + батч крон-консолидатора одноимённых сущностей (Ф1b кросс-типовая консолидация)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-table-graphsync.ts',
    hint: 'table.graphsync.{enabled,min_confidence} — kill-switch + порог авто-создания строк умных таблиц из графа (smart-tables Ф4)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-employee-stand.ts',
    hint: 'me.tasks.doneWindowDays + operations.personal_day_narrative.{enabled,evening_hour} + operations.self_signals.plan_not_closing_streak_days + knowledge.expertise.self_{max_blocks_scanned,top_k} (стенд сотрудника)',
  },
  {
    phase: 'seed-base',
    script: 'scripts/seed-admin-setting-task-solution.ts',
    hint: 'aiFeatures.taskSolutionEnabled (kill-switch) + taskSolution.{buildHourMsk,minSignalChars,lookbackHours,repeatThreshold,repeatSimilarity,refineEnabled,howSolvedSignalTypes,ownerInferenceEnabled,maxPlaceholderRatio} (сущность «Решение задачи»)',
  },

  ...[
    'phase-B',
    'phase-C',
    'phase-D',
    'phase-E',
    'regulations',
    'knowledge-clone',
    'knowledge-core',
    'decisions',
    'insights',
    'ideas-and-probe',
    'skill-and-clone',
    'skill-concept',
    'chat-v2',
    'recognition',
    'helpfulness',
    'beta-8',
    'beta-8-1',
    'beta-8-2',
    'beta-8-3',
    'axis-classify',
    'brand-voice',
    'company-foundation',
    'concierge',
    'cross-functional',
    'experiments',
    'process-template',
    'role-map',
    'orchestrator',
    'proactive',
    'tracker-phase3',
    'tracker-phase3-c',
    'tracker-phase4-telegram',
    'feedback-cluster',
    'clone-v2',
    'specialists-combined',
    'dialog-layer',
    'temporal',
    'kie-grsai-ab',
    'dialog-extract-plan',
    'sprints',
    'agents-v2',
    'pulse-w3',
    'pulse-w4',
    'smart-tables',
    'curation',
    'goals',
    'task-dedupe',
    'task-dedup-arbiter',
    'task-closure-verify',
    'goal-task-link',
    'support',
    'compile-org-document',
    'conflict-arbiter',
    'clone-method',
    'edinyy-pomoshnik',
    'chat',
  ].map<Step>((sub) => ({
    phase: 'seed-llm-routes',
    script: `scripts/seed-llm-task-routes-${sub}.ts`,
  })),

  {
    phase: 'seed-llm-routes',
    script: 'scripts/seed-llm-task-routes-missing-registry.ts',
    hint: '5 потерянных taskType (specialists-combined/dialog-mq-clone/checkin-batch/experiment-*)',
  },

  { phase: 'seed-llm-default', script: 'scripts/seed-llm-default-primary-deepseek-pro.ts' },
  {
    phase: 'seed-llm-default',
    script: 'scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts',
    hint: 'нормализация к deepseek→openai→kie, вывод gpt-4o (БЕЗ --force: steady-state)',
  },
  {
    phase: 'patch',
    script: 'scripts/patch-block-ingest-capable-model.ts',
    hint: 'block-ingest развилка idea↔decision → deepseek-v4-pro/gpt-5.4 (ТЗ idv Ф2; БЕЗ --force: уважает админ-правки)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-task-extractor-route-pro.ts',
    hint: '4 извлекающих taskType (meeting-extract-actions/decision-extract/idea-extract/insight-extract) + tasks → primary deepseek-v4-pro (фаза E R3; уважает админ-правки, идемпотентно)',
    skipBootstrap: true,
  },

  { phase: 'patch', script: 'scripts/patch-rename-client-to-customer.ts', skipBootstrap: true },
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-entity-custom-to-topic.ts',
    skipBootstrap: true,
  },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-document.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-goal.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-person.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-person-relationship.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-card-versions.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/backfill-rule-summaries.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-document-use-cases-default.ts', skipBootstrap: true },
  {
    phase: 'patch',
    script: 'scripts/patch-team-templates-ru.ts',
    hint: 'русификация ролей шаблона продаж (SDR→квалификация, BANT/CHAMP→методика)',
    skipBootstrap: true,
  },
  { phase: 'patch', script: 'scripts/patch-org-timezone-default.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-person-timezone-default.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-expire-retired-probe-backlog.ts', skipBootstrap: true },
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-mvs-to-company-profile.ts',
    args: ['--apply'],
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-person-role-to-appointment.ts',
    args: ['--apply'],
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-skill-trait-categories-from-strings.ts',
    skipBootstrap: true,
  },
  { phase: 'patch', script: 'scripts/patch-bitemporal-backfill.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-clones-role-versioning.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-clones-dataclass-update.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-dataclass-audit.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-channel-binding-defaults.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-extract-strong-ids.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-prompt-block-ingest-v2-fase0b.ts', skipBootstrap: true },
  {
    phase: 'patch',
    script: 'scripts/patch-prompt-role-profile-build-fase0d.ts',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-chat-v2-to-pro.ts',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-mass-migrate-to-deepseek-pro.ts',
    args: ['--update-existing'],
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-enable-chatbox-analysis.ts',
    args: ['--apply'],
    hint: 'ChatBox analysisEnabled=true для подключённых (§5)',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-deepseek-chat-to-flash.ts',
    args: ['--apply'],
    hint: 'deepseek-chat → deepseek-v4-flash во всех LlmTaskRoute',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-ensure-meeting-report-fast-fallback.ts',
    hint: 'fallback openai+ollama для meeting-report-fast',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-llm-routes-report-chain-deepseek.ts',
    hint: 'summary/report-by-type/tasks → DeepSeek (кэш)',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-llm-routes-analyze-worker-1to1.ts',
    hint: 'форсирует 1:1-легаси-совместимую цепочку (deepseek-v4-pro→minimax→openai-via-proxy gpt-5-mini) для summary/report-by-type/follow-up/custom-prompt/client-meeting-split — миграция analyze.worker на LlmRouterService (ТЗ 2026-07-03), временно, до отдельного решения владельца об экономии на дешёвых моделях',
    skipBootstrap: true,
    everyDeploy: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-check-legacy-ab-experiments.ts',
    hint: 'read-only: предупреждение об активных легаси route.experiment после вывода AdminExperimentsService из эксплуатации (ТЗ 2026-07-03 Фаза 2)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-enable-shipped-flags.ts',
    skipBootstrap: true,
    everyDeploy: true,
    hint: 'Ship-On: включить готовые фичи (tables_text_to_schema, curationAutotuneEnabled)',
  },
  {
    phase: 'patch',
    script: 'scripts/patch-enable-telegram-digests.ts',
    skipBootstrap: true,
    everyDeploy: true,
    hint: 'включить доставку дайджестов COO + пульса целей в Telegram (TZ-1 Ф0)',
  },
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-clone-access.ts',
    hint: 'миграция грантов перед CLONE_V2_ENABLED=true',
  },
  {
    phase: 'patch',
    script: 'scripts/patch-rebrand-z-to-kora.ts',
    hint: 'ребренд Z → Кора в EmailTemplate',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-rehash-pending-invitations.ts',
    hint: 'sha256→argon2id для tempPasswordHash',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-mark-demo-data.ts',
    hint: 'backfill externalSource=demo для existing demo-Org',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-encrypt-tochka-oauth.ts',
    hint: 'AES-256-GCM для tochka oauth tokens',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-encrypt-llm-provider-keys.ts',
    hint: 'AES-256-GCM для LlmProvider.apiKeyEncrypted (llm-providers-models-routing-admin Ф2 Б5); идемпотентно (isEncrypted-фильтр)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-llm-provider-protocols.ts',
    hint: 'kie/grsai custom-http → честные протоколы; деактивация опечатки gpt-5-4',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-dedupe-billing-event-log.ts',
    hint: 'dedupe BillingEventLog по (providerName,externalEventId)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-dedupe-referral-payout.ts',
    hint: 'dedupe ReferralPayout по triggerInvoiceId',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-backfill-referral-attribution-date-bucket.ts',
    hint: 'backfill dateBucket + dedupe для composite unique',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-daily-checkin-backfill-source.ts',
    hint: 'backfill source=manual для DailyCheckIn без notificationId',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-rollback-to-deepseek-flash.ts',
    hint: 'INCIDENT-ONLY: rollback deepseek-v4-pro → flash, запускать руками',
    skipBootstrap: true,
    skipUpdate: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-audit-user-email-conflicts.ts',
    hint: 'verify (dry-run-only): email/role конфликты в User',
    skipBootstrap: true,
    skipUpdate: true,
  },
  {
    phase: 'patch',
    script: 'scripts/migrate-entitlements-to-standard.ts',
    hint: 'legacy tier → tier_standard',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-create-reference-demo-org.ts',
    hint: 'эталонная Demo-Org «ТехноСтрим» + ZDEMO_ORG_ID',
    skipBootstrap: false,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-old-demo-orgs.ts',
    hint: 'миграция старых «копий ТехноСтрим» → demo_observer наблюдатели',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-cleanup-egress-phantom-participants.ts',
    hint: 'удалить фантомных Participant с identity не host:/guest: (egress)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-meeting-type-closed-defaults.ts',
    hint: 'interview → defaultClosedGroupKind=personal (Ф8 knowledge-access)',
    skipBootstrap: true,
  },
  {
    phase: 'patch',
    script: 'scripts/patch-remove-phantom-admin-settings.ts',
    args: ['--apply'],
    hint: 'Удаляет осиротевшие AdminSetting-строки под 39 phantom-ключами (нет читателя, unregistered). Идемпотентно (повтор → 0). History сохранён.',
    skipBootstrap: true,
  },
  { phase: 'patch', script: 'scripts/patch-company-summary-weekly.ts', skipBootstrap: true },

  { phase: 'backfill', script: 'scripts/backfill-meeting-sources-fase1.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-idea-quality.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-entity-link-types-fase0.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-commitment-due-dates.ts', skipBootstrap: true },
  {
    phase: 'backfill',
    script: 'scripts/backfill-ai-cost-daily-gap.ts',
    skipBootstrap: true,
    hint: 'AiCostDaily за 2026-05-09..2026-05-23 — период до появления ночного крона',
  },
  { phase: 'backfill', script: 'scripts/backfill-meeting-linked-ids.ts', hint: 'IntakeIssue.meetingId → Issue.linkedMeetingIds backfill (intake-issue-linked-meeting-ids-fix, только meeting:-формат externalId)', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-day-report.ts', skipBootstrap: true, hint: 'сборка дневных отчётов из block-ingest за 30 дней (4 сущности)' },
  {
    phase: 'backfill',
    script: 'scripts/backfill-decision-linked-task-count.ts',
    hint: 'Decision.linkedTaskCount + DecisionTaskLink из sourceBlockIds (TZ-1 Ф3.B)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-decisions-from-signals.ts',
    hint: 'Переэкстракция decision-сигнальных блоков без Decision (ТЗ decision-materialization-idempotency Ф6) — идемпотентно через 3-3',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-rename-z-sources.ts',
    hint: 'Source «Встречи Z»→«Встречи», «Трекер Z»→«Трекер» (бренд Z→Кора)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-default-board.ts',
    hint: 'default Board + issues.boardId backfill',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-gant-view.ts',
    hint: 'Гант по умолчанию ON: gantViewEnabled false→true существующим проектам (Ф4 Ship-On)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-system-generated-projects.ts',
    hint: 'пометить org-контейнеры «Спринт компании» systemGenerated=true (A6)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-reclassify-instructions.ts',
    args: ['--apply'],
    hint: 'Process scope=role:* → Instruction (A10)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-merge-duplicate-persons.ts',
    args: ['--apply'],
    hint: 'Слить дубли Person по email (Команда)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-onboarding-setup-completed.ts',
    hint: 'Онбординг v2: выставляет setupCompletedAt для Org с отделами',
    skipBootstrap: false,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-meetings-balance.ts',
    hint: 'стартовый MeetingsBalance=150 для всех Org',
    skipBootstrap: true,
  },

  {
    phase: 'backfill',
    script: 'scripts/backfill-demo-subscriptions.ts',
    hint: 'DEMO-подписка для Org, существовавших до paywall',
    skipBootstrap: true,
  },

  {
    phase: 'backfill',
    script: 'scripts/backfill-knowledge-clone-after-router-fix.ts',
    hint: 'enqueue KnowledgeProfile rebuild для employee с expertise/experience/competence блоками (after router fix Фаза 0.5)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-knowledge-clone-person-entity.ts',
    args: ['--apply'],
    skipBootstrap: true,
    hint: 'C1-#4 — Person.entityId/entityTenantId lazy-резолв через EntityResolutionService (оба поля композитного FK); идемпотентно (entityId set → skip)',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-skill-profiles-rebuild.ts',
    hint: 'enqueue rebuild всех active SkillProfile после расширения signalType на methodology_step (clone-signaltype-methodology-step Ф3); jobId-дедуп',
    skipBootstrap: true,
  },

  {
    phase: 'backfill',
    script: 'scripts/backfill-edge-temporal.ts',
    hint: 'validFrom = createdAt, validUntil = NULL для IdeaBlockLink/EntityLink (Agents v2 Фаза A1)',
    skipBootstrap: false,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-system-tables.ts',
    hint: 'Smart-tables Фаза 0: 10 системных таблиц для существующих Org',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-table-entity-sync.ts',
    hint: 'Smart-tables Фаза 2: graph-driven строки в системные autoCreate-таблицы',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-goal-v2-defaults.ts',
    hint: 'Goals OKR v2: recordedAt=createdAt для legacy-целей',
    args: ['--apply'],
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-owner-person.ts',
    args: ['--apply'],
    hint: 'Person для владельцев Org без Person (Ф9)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-subject-attribution.ts',
    hint: 'role=subject для исторических reasoning-блоков + rebuild клонов (Ф1.3)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-subject-attribution-all-types.ts',
    hint: 'role=subject для исторических блоков ВСЕХ типов + per-adapter identity (Ф1 knowledge-access)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-block-access.ts',
    args: ['--departments'],
    hint: 'department-группы для исторических блоков по флагу --departments (Ф3 knowledge-access)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-commitment-author.ts',
    hint: 'ТЗ-D: заполнение commitmentAuthorPersonId для исторических обещаний',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-chatbox-subject-cleanup.ts',
    args: ['--apply'],
    hint: 'очистка ложных subject=менеджер от chatbox (cross-attribution)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-chatbox-unregister-webhooks.ts',
    hint: 'снять внешние ChatBox-вебхуки через API (приём вебхуков удалён, только суточный синк)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-chatbox-customers-from-person.ts',
    skipBootstrap: true,
    hint: 'ChatBox клиенты Person{external} → Customer/Entity{customer} + контакты Entity{person}; осиротевшие Person soft-delete',
  },
  { phase: 'backfill', script: 'scripts/backfill-purge-junk-entities.ts', skipBootstrap: true },
  {
    phase: 'backfill',
    script: 'scripts/backfill-role-clone-single-bearer.ts',
    hint: 'клоны ролей → single-bearer + freeze бывших (Раздел 7 §7.6)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-integration-persons-to-employee.ts',
    hint: 'persons, связанные с Bitrix-юзерами/Chatbox-менеджерами: external → employee',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-regulation-consolidate.ts',
    hint: 'разовая консолидация дублей регламентов + миграция legacy Process→ProcessTemplate (cosine>0.85) (R17 Ф5b)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-provenance-preview.ts',
    hint: 'previewQuote+previewSourceRef для Decision/Issue/Regulation (провенанс Ф2)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-source-layer.ts',
    hint: 'SourceEpisode/SourceParticipant/SourceEntity для существующих RawEvent (слой источника Ф2); embedding=null, проставится при ре-эмбеддинге',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-reembed-blocks-no-header.ts',
    hint: 'ре-эмбеддинг IdeaBlock БЕЗ контекст-хедера (block-space=query-space, Ф2 консолидации) + REINDEX HNSW; идемпотентно по contextHeaderVersion=noheader-v1. ОБЯЗАТЕЛЬНО вместе с выкатом кода (иначе смешанное header-ful/header-less пространство → KNN хуже). Без --org=ALL orgs',
    skipBootstrap: true,
  },
  {
    phase: 'migrate',
    script: 'scripts/migrate-telegram-channels-to-global.ts',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-chat-bridge-telegram.ts',
    hint: 'мост-загрузка Telegram-экспорта в граф (Ф0): требует --tenant=<orgId> --file=<result.json>; запускается оператором вручную, идемпотентно по messageExternalId',
    skipBootstrap: true,
    skipUpdate: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-issuecomment-to-message.ts',
    hint: 'перенос legacy IssueComment → Message в work_chat (единый чат Ф2.5b); ensureWorkChat + insertHistorical, перепривязка attachments/recognition, маркер IssueComment.messageId. Идемпотентно (messageId!=null пропускается, clientMessageId=ic:<id> дедуп)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-message-contentstripped.ts',
    hint: 'plaintext в Message.contentStripped для GIN-поиска (единый чат Ф4a); decrypt(content)→stripToPlain. Идемпотентно (contentStripped=null фильтр)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-regulation-scope-normalize.ts',
    args: ['--apply'],
    hint: 'regulation/instruction/policy/process: scope=role:<сырое имя> → role:<cuid> по созданным ролям (Фаза 7б); идемпотентно (cuid-хвост = no-op, неразрешимое остаётся сырьём)',
    skipBootstrap: true,
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-entity-tenant-companions.ts',
    skipBootstrap: true,
    args: ['--apply'],
    hint: 'Пакет A: заполнить entityTenantId/mergedIntoTenantId-компаньоны (idempotent)',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-reconcile-merged-entity-refs.ts',
    skipBootstrap: true,
    args: ['--apply'],
    hint: 'Пакет A: перепривязать осиротевшие ссылки на уже-слитые сущности к канону (idempotent)',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-client-to-customer.ts',
    skipBootstrap: true,
    hint: 'Ф1b: детерминированный client→customer для активных Entity (idempotent); ДО консолидации одноимённых',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-entity-consolidate-same-name.ts',
    skipBootstrap: true,
    hint: 'Ф1b: кросс-типовая консолидация одноимённых сущностей (после client→customer); LLM-арбитр + матрица приоритета типов',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-table-graphsync.ts',
    skipBootstrap: true,
    hint: 'smart-tables Ф4: проставить Table.graphSync системным таблицам из каталога + reconcile строк из графа (Goal/Experiment/IdeaBlock) по всем Org; идемпотентно',
  },
  {
    phase: 'backfill',
    script: 'scripts/backfill-company-channel.ts',
    skipBootstrap: true,
    hint: 'дожать обязательный канал «Вся компания» + членство всех активных сотрудников для существующих Org (messaging-new-conversation Ф2); ensureCompanyChannel upsert, идемпотентно (повтор → created:0)',
  },
];

interface ParsedArgs {
  mode: 'bootstrap' | 'update' | 'all';
  dryRun: boolean;
  continueOnFail: boolean;
  withSchema: boolean;
  failOnSteps: boolean;
  verbose: boolean;
  rerunAll: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'all';
  let dryRun = false;
  let continueOnFail = false;
  let withSchema = false;
  let failOnSteps = true;
  let verbose = process.env['APPLY_PROD_DEPLOY_VERBOSE'] === '1';
  let rerunAll = process.env['DEPLOY_RERUN_ALL'] === '1';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') {
      const v = argv[++i];
      if (v === 'bootstrap' || v === 'update' || v === 'all') mode = v;
      else throw new Error(`Unknown --mode value: ${v}`);
    } else if (a === '--dry-run') dryRun = true;
    else if (a === '--continue-on-fail') continueOnFail = true;
    else if (a === '--with-schema') withSchema = true;
    else if (a === '--no-fail-on-steps') failOnSteps = false;
    else if (a === '--verbose') verbose = true;
    else if (a === '--rerun-all') rerunAll = true;
    else if (a === '--help' || a === '-h') {
       
      console.log(
        `Usage: bun run scripts/apply-prod-deploy.ts [--mode bootstrap|update|all] [--with-schema] [--dry-run] [--continue-on-fail] [--no-fail-on-steps] [--verbose]\n` +
          `  --with-schema       авто-бэкап БД → dedupe → prisma migrate deploy → apply-postgres-init,\n` +
          `                      затем обычные seed/patch/backfill. Делает выкат одной командой.\n` +
          `  --no-fail-on-steps  не падать из-за упавших seed/backfill (schema-сбой всё равно = exit 1).\n` +
          `                      Для migrate-контейнера: схема блокирует backend, осечка сида — нет.\n` +
          `  --verbose           полный вывод каждого шага (по умолчанию — тихо, 1 строка/шаг,\n` +
          `                      полный лог только у упавших). Также env APPLY_PROD_DEPLOY_VERBOSE=1.\n` +
          `  --rerun-all         игнорировать журнал ${LEDGER_TABLE} и заново прогнать все\n` +
          `                      одноразовые patch/backfill/migrate/seed-llm-routes. По умолчанию\n` +
          `                      они скипаются, если содержимое скрипта не менялось (хэш в журнале).\n` +
          `                      Также env DEPLOY_RERUN_ALL=1.`,
      );
      process.exit(0);
    }
  }
  return { mode, dryRun, continueOnFail, withSchema, failOnSteps, verbose, rerunAll };
}

async function autoBackup(): Promise<boolean> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // eslint-disable-next-line no-console
    console.error(
      '[schema] autoBackup: DATABASE_URL не задан — бэкап невозможен, migrate отменён.',
    );
    return false;
  }
  const dir = '/app/backups';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${dir}/pre-deploy-${ts}.dump`;
   
  console.log(`\n=== AUTO-BACKUP (перед migrate deploy) → ${file} ===`);
  await Bun.spawn(['mkdir', '-p', dir], { stdout: 'inherit', stderr: 'inherit' }).exited;
  const proc = Bun.spawn(['pg_dump', url, '-Fc', '-f', file], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
     
    console.error(
      `[schema] ✗ pg_dump упал (exit ${code}). migrate deploy НЕ выполняется без бэкапа. ` +
        `Проверь, что pg_dump есть в образе (postgresql16-client) и postgres доступен.`,
    );
    return false;
  }
   
  console.log(
    `[schema] ✓ Бэкап создан: ${file}\n` +
      `         restore: docker compose run --rm --no-deps backend ` +
      `pg_restore --clean --if-exists -d "$DATABASE_URL" ${file}`,
  );
  return true;
}

async function psqlScalar(url: string, sql: string): Promise<string | null> {
  const proc = Bun.spawn(['psql', url, '-tAc', sql], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    const err = await new Response(proc.stderr).text();
     
    console.error(`[schema] psqlScalar упал: ${err.slice(-500)}`);
    return null;
  }
  return out.trim();
}

async function psqlExec(url: string, sql: string): Promise<boolean> {
  const proc = Bun.spawn(['psql', url, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0;
}

async function psqlExecQuiet(url: string, sql: string): Promise<boolean> {
  const proc = Bun.spawn(['psql', url, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return (await proc.exited) === 0;
}

async function ensureLedger(url: string): Promise<boolean> {
  const created = await psqlExecQuiet(
    url,
    `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (script text PRIMARY KEY, hash text, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  if (!created) return false;
  return psqlExecQuiet(url, `ALTER TABLE ${LEDGER_TABLE} ADD COLUMN IF NOT EXISTS hash text`);
}

async function loadAppliedSteps(url: string): Promise<Map<string, string>> {
  const out = await psqlScalar(
    url,
    `SELECT COALESCE(string_agg(script || E'\\t' || COALESCE(hash, ''), E'\\n'), '') FROM ${LEDGER_TABLE}`,
  );
  const map = new Map<string, string>();
  if (out === null) return map;
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) {
      map.set(line.trim(), '');
      continue;
    }
    map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

async function markApplied(url: string, script: string, hash: string): Promise<void> {
  const s = script.replace(/'/g, "''");
  const h = hash.replace(/'/g, "''");
  await psqlExecQuiet(
    url,
    `INSERT INTO ${LEDGER_TABLE}(script, hash) VALUES('${s}', '${h}') ` +
      `ON CONFLICT (script) DO UPDATE SET hash = EXCLUDED.hash, applied_at = now()`,
  );
}

function withPublicSearchPath(url: string): string {
  if (/[?&]options=/.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}options=-c%20search_path%3Dpublic`;
}

async function ensureBaseline(): Promise<boolean> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
     
    console.error('[schema] ensureBaseline: DATABASE_URL не задан.');
    return false;
  }

  const migrateUrl = withPublicSearchPath(url);

  const migSchema = await psqlScalar(
    url,
    'SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      "WHERE c.relname = '_prisma_migrations' ORDER BY (n.nspname = 'public') DESC LIMIT 1",
  );
  if (migSchema === null) return false;

  if (migSchema !== '' && migSchema !== 'public') {
    // eslint-disable-next-line no-console
    console.log(
      `\n>>> [schema] _prisma_migrations в схеме "${migSchema}" (AGE search_path) → переношу в public.`,
    );
    if (!(await psqlExec(url, `ALTER TABLE "${migSchema}"._prisma_migrations SET SCHEMA public`))) {
       
      console.error('[schema] ✗ не удалось перенести _prisma_migrations в public.');
      return false;
    }
    // eslint-disable-next-line no-console
    console.log(
      '[schema] ✓ _prisma_migrations перенесена в public → migrate deploy применит pending.',
    );
    return true;
  }

  if (migSchema === 'public') {
     
    console.log('[schema] baseline есть (_prisma_migrations в public) → обычный migrate deploy.');
    return true;
  }

  const hasTables = await psqlScalar(
    url,
    `SELECT count(*) FROM pg_class WHERE relname = 'User' AND relkind = 'r'`,
  );
  if (hasTables === null) return false;
  if (hasTables === '0') {
     
    console.log('[schema] пустая БД — migrate deploy создаст схему с нуля (0_init).');
    return true;
  }

  // eslint-disable-next-line no-console
  console.log(
    '\n>>> [schema] АВТО-BASELINE: существующая БД без _prisma_migrations → resolve --applied 0_init.',
  );
  const resolve = Bun.spawn(['bunx', 'prisma', 'migrate', 'resolve', '--applied', '0_init'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DATABASE_URL: migrateUrl },
  });
  const resolveOut =
    (await new Response(resolve.stdout).text()) + (await new Response(resolve.stderr).text());
  // eslint-disable-next-line no-console
  console.log(resolveOut.trim());
  if ((await resolve.exited) !== 0) {
    if (/P3008|already recorded as applied/i.test(resolveOut)) {
       
      console.log('[schema] 0_init уже отмечен applied (P3008) — продолжаем.');
      return true;
    }
     
    console.error('[schema] ✗ migrate resolve --applied 0_init упал.');
    return false;
  }
   
  console.log('[schema] ✓ авто-baseline завершён.');
  return true;
}

async function runSchemaPhase(
  dryRun: boolean,
  continueOnFail: boolean,
  verbose: boolean,
): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.log('\n=== SCHEMA PHASE (--with-schema) ===');
  if (dryRun) {
     
    console.log(
      '>>> [schema] (dry-run) auto-backup + dedupe + auto-baseline + prisma migrate deploy + apply-postgres-init',
    );
    return true;
  }

  if (!(await autoBackup())) return false;

  const preDedupe: Step[] = [
    { phase: 'patch', script: 'scripts/patch-dedupe-billing-event-log.ts' },
    { phase: 'patch', script: 'scripts/patch-dedupe-referral-payout.ts' },
  ];
  for (const s of preDedupe) {
    const r = await runOne(s, false, verbose);
    if (!r.ok && !continueOnFail) return false;
  }

  if (!(await ensureBaseline())) return false;

  const preMigrate: Step[] = [
    { phase: 'migrate', script: 'scripts/migrate-task-to-issue.ts', args: ['--apply'] },
    { phase: 'backfill', script: 'scripts/backfill-collapse-legacy-task-duplicates.ts', args: ['--apply'] },
    {
      phase: 'backfill',
      script: 'scripts/backfill-embeddings-gemma-768.ts',
      hint: 'embeddinggemma 768 dim (TZ 2026-06-30) — после миграции vector(1536)→vector(768) обнуляет все эмбеддинги; backfill через LocalEmbeddingService. Идемпотентно (WHERE embedding IS NULL)',
      skipBootstrap: true,
    },
  ];
  for (const s of preMigrate) {
    const r = await runOne(s, false, verbose);
    if (!r.ok && !continueOnFail) return false;
  }

  const dbUrl = process.env['DATABASE_URL'];

  console.log('\n>>> [schema] bunx prisma migrate deploy');
  const push = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(dbUrl ? { env: { ...process.env, DATABASE_URL: withPublicSearchPath(dbUrl) } } : {}),
  });
  if ((await push.exited) !== 0) return false;

  // eslint-disable-next-line no-console
  console.log('\n>>> [schema] bun scripts/apply-postgres-init.ts');
  const init = Bun.spawn(['bun', 'scripts/apply-postgres-init.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await init.exited) !== 0 && !continueOnFail) return false;

  return true;
}

function filterSteps(steps: readonly Step[], mode: ParsedArgs['mode']): Step[] {
  return steps.filter((s) => {
    if (mode === 'bootstrap' && s.skipBootstrap) return false;
    if (mode === 'update' && s.skipUpdate) return false;
    return true;
  });
}

function pickSummaryLine(out: string): string {
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const re =
    /(inserted|created|updated|skipped|applied|patched|scanned|deleted|backfilled|voided|protected)/i;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/^===/.test(l) || /START/i.test(l)) continue;
    if (re.test(l)) return l.length > 160 ? `${l.slice(0, 157)}…` : l;
  }
  return '';
}

async function runOne(
  step: Step,
  dryRun: boolean,
  verbose: boolean,
): Promise<{ ok: boolean; code: number }> {
  const cmd = ['bun', 'run', step.script, ...(step.args ?? [])];
  const label = `[${step.phase}] ${cmd.slice(2).join(' ')}${step.hint ? `  # ${step.hint}` : ''}`;
  if (dryRun) {
     
    console.log(`>>> ${label}`);
    return { ok: true, code: 0 };
  }

  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

  if (verbose) {

    console.log(`\n>>> ${label}`);
    const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill(9);
    }, timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    if (timedOut) {
      // eslint-disable-next-line no-console
      console.error(
        `✗ ${label}  (ТАЙМАУТ ${Math.round(timeoutMs / 1000)}s — процесс убит, шаг пропущен)`,
      );
      return { ok: false, code: 124 };
    }
    return { ok: code === 0, code };
  }

  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, timeoutMs);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  if (timedOut) {
    // eslint-disable-next-line no-console
    console.error(
      `\n✗ ${label}  (ТАЙМАУТ ${Math.round(timeoutMs / 1000)}s — процесс убит, шаг пропущен)`,
    );
    if (out.trim()) {
      // eslint-disable-next-line no-console
      console.error(out.trimEnd());
    }
    if (err.trim()) {
      // eslint-disable-next-line no-console
      console.error(err.trimEnd());
    }
    return { ok: false, code: 124 };
  }
  if (code === 0) {
    const summary = pickSummaryLine(out);
     
    console.log(`✓ ${label}${summary ? `  — ${summary}` : ''}`);
    return { ok: true, code };
  }
  // eslint-disable-next-line no-console
  console.error(`\n✗ ${label}  (exit ${code})`);
  if (out.trim()) {
     
    console.error(out.trimEnd());
  }
  if (err.trim()) {
     
    console.error(err.trimEnd());
  }
  return { ok: false, code };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const steps = filterSteps(STEPS, args.mode);

   
  console.log(
    `=== apply-prod-deploy mode=${args.mode} withSchema=${args.withSchema} dryRun=${args.dryRun} steps=${steps.length} ===`,
  );

  if (args.withSchema) {
    const ok = await runSchemaPhase(args.dryRun, args.continueOnFail, args.verbose);
    if (!ok) {
       
      console.error('\n✗ SCHEMA PHASE упала (бэкап или push). Остановка — данные не тронуты.');
      process.exit(1);
    }
  }

  const dbUrl = process.env['DATABASE_URL'];
  const ledgerOn = !args.dryRun && !!dbUrl;
  let applied = new Map<string, string>();
  if (ledgerOn) {
    await ensureLedger(dbUrl!);
    applied = await loadAppliedSteps(dbUrl!);
    if (args.rerunAll) {
      // eslint-disable-next-line no-console
      console.log(`\n[ledger] --rerun-all: журнал игнорируется, одноразовые шаги прогоняются заново.`);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `\n[ledger] записей в журнале: ${applied.size} ` +
          `(одноразовые шаги с неизменённым содержимым будут пропущены).`,
      );
    }
  }

  const results: { step: Step; ok: boolean; code: number }[] = [];
  let skipped = 0;
  for (const step of steps) {
    const once = ledgerOn && isOnceStep(step);
    const curHash = once ? await stepHash(step) : null;
    if (once && !args.rerunAll && curHash !== null && applied.get(step.script) === curHash) {
      skipped++;
      results.push({ step, ok: true, code: 0 });
      continue;
    }
    const r = await runOne(step, args.dryRun, args.verbose);
    results.push({ step, ...r });
    if (r.ok && once) {
      await markApplied(dbUrl!, step.script, curHash ?? '');
    }
    if (!r.ok && !args.continueOnFail) {
      // eslint-disable-next-line no-console
      console.error(
        `\n✗ ${step.script} упал (exit ${r.code}). Остановка (используй --continue-on-fail чтобы продолжать).`,
      );
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);

  console.log(`\n=== SUMMARY ===`);
  // eslint-disable-next-line no-console
  console.log(
    `Всего: ${results.length}, OK: ${results.length - failed.length}, FAIL: ${failed.length}, пропущено по журналу: ${skipped}`,
  );
  if (failed.length) {
     
    console.log(`\nУпавшие:`);
    for (const f of failed) {
       
      console.log(`  ✗ ${f.step.script} (exit ${f.code})`);
    }
    if (args.failOnSteps) {
      process.exit(1);
    }
     
    console.log(
      `\n⚠ ${failed.length} step(s) упали, но --no-fail-on-steps → выходим 0 ` +
        `(схема применена, backend может стартовать; перезапусти скрипты по списку выше).`,
    );
    return;
  }
   
  console.log(`✓ ALL APPLIED`);
}

main().catch((err) => {
   
  console.error('apply-prod-deploy FAILED:', err);
  process.exit(1);
});
