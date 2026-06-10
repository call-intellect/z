/**
 * Агрегирующий скрипт для prod-деплоя: запускает все seed/patch/backfill/migrate
 * скрипты в правильной последовательности.
 *
 * Цель — одна команда вместо ручного копипаста ~80 строк из prod-deploy-log.md.
 *
 * Использование:
 *   docker compose exec backend bun run scripts/apply-prod-deploy.ts [--mode <mode>]
 *
 * Режимы:
 *   --mode bootstrap  — для ЧИСТОГО старта (Сценарий B): только seed-скрипты.
 *                       Не запускает patch/backfill/migrate (нечего бэкфилить).
 *   --mode update     — для ОБНОВЛЕНИЯ работающего прода (Сценарий A): patch + seed
 *                       + backfill + migrate. Подразумевает что схема уже накатана.
 *   --mode all        — bootstrap + update подряд (по умолчанию).
 *
 * Дополнительно:
 *   --dry-run         — показать что будет запущено, не выполнять.
 *   --continue-on-fail — продолжать при ошибке скрипта (default: stop on first fail).
 *
 * Каждая фаза выводит progress. В конце — summary: успешные/упавшие.
 *
 * ВАЖНО: bun-скрипт. Не использует Nest — работает напрямую через child-процессы
 * `bun run scripts/<name>.ts`.
 *
 * Поддержка нового скрипта: добавить его в массив PHASES ниже, в нужную фазу.
 * Правила см. в `docs/operations/prod-deploy-log.md` → «Правила поддержки файла».
 */

type Phase = 'bootstrap-admin' | 'seed-llm-core' | 'seed-base' | 'seed-llm-routes' | 'seed-llm-default' | 'patch' | 'backfill' | 'migrate';

interface Step {
  phase: Phase;
  script: string;
  /** Подсказка о том, что делает скрипт — в выводе. */
  hint?: string;
  /** Доп. args, например `--apply` или `--update-existing`. */
  args?: string[];
  /** Если true — пропустить в режиме `bootstrap` (например, patch'и для legacy). */
  skipBootstrap?: boolean;
  /** Если true — пропустить в режиме `update` (например, bootstrap super-admin). */
  skipUpdate?: boolean;
}

const STEPS: Step[] = [
  // === Bootstrap super-admin (только для чистого старта) ===
  {
    phase: 'bootstrap-admin',
    script: 'prisma/seed.ts',
    hint: 'super-admin из ADMIN_BOOTSTRAP_EMAIL',
    skipUpdate: true,
  },

  // === Базовый каркас LLM (нужен для AI-фич) ===
  { phase: 'seed-llm-core', script: 'scripts/seed-default-llm-providers-and-models.ts' },
  { phase: 'seed-llm-core', script: 'scripts/seed-llm-model-prices.ts' },
  { phase: 'seed-llm-core', script: 'scripts/seed-prompt-templates.ts', hint: '13 системных шаблонов' },
  { phase: 'seed-llm-core', script: 'scripts/seed-llm-task-routes-default.ts', hint: 'дефолтные цепочки' },

  // === Базовые seed'ы (тарифы, календарь, шаблоны, домены, бейджи, TG) ===
  { phase: 'seed-base', script: 'scripts/seed-entitlements.ts' },
  { phase: 'seed-base', script: 'scripts/seed-retention-policies.ts' },
  { phase: 'seed-base', script: 'scripts/seed-holiday-calendar-ru-2026.ts' },
  { phase: 'seed-base', script: 'scripts/seed-team-templates.ts' },
  { phase: 'seed-base', script: 'scripts/seed-functional-domains.ts' },
  { phase: 'seed-base', script: 'scripts/seed-admin-settings.ts' },
  { phase: 'seed-base', script: 'scripts/seed-admin-settings-billing.ts', hint: '6 ключей billing.* для tier_standard' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-daily-digest.ts' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-dashboard-main.ts', hint: 'dashboard.main_rework.enabled kill-switch (ТЗ-2 Ф1 новая компоновка главной директора)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-goals-pulse.ts', hint: 'goals.pulse.{enabled,deliver_to_telegram} (Goals OKR v2 Фаза 4)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-chatbox.ts', hint: 'chatbox.session.idle_gap_hours + chatbox.enabled (ChatBox-интеграция)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-notification-budget.ts', hint: 'notifications.daily_budget.* + quiet_hours.* + binding_campaign.enabled (TZ-1 Ф0 daily-value)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-customer-risk.ts', hint: 'customer_risk.window_days + weight.* + threshold.* + operations.customer_risk_radar.enabled (TZ-1 Ф1 радар клиентов)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-personal-brief.ts', hint: 'operations.personal_daily_brief.{enabled,morning_hour} + operations.knows_who.enabled + knows_who.min_confidence (TZ-1 Ф2 движок рядового)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-execution-agents.ts', hint: 'goals.author_coverage_min + reliability.min_denominator + probe.* (Ф3.D) + blocker_synthesis.* + decision.stale_days + operations.{blocker_synthesis,decision_controller,promise_cascade}.enabled (TZ-1 Ф3.A/B/C агенты исполнения)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-knowledge-improvement-agents.ts', hint: 'ideas.feed.* + insight.recheck_days + team_capacity.{overload,underload}_percent + onboarding.silent_days + 5 kill-switch (ideas.feed/insights.recheck/operations.{knowledge_at_risk,team_capacity,onboarding_ramp}.enabled) (TZ-1 Ф4 улучшения и знания)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-value-recap.ts', hint: 'operations.value_recap.enabled + chat_v2.feedback.{enabled,min_rated,retry_dedup_seconds} (TZ-1 Ф5 месячная витрина value-recap)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-operations-dashboard.ts', hint: 'operations.dashboard_rework.enabled kill-switch (ТЗ-2 Ф2 новая раскладка COO-дашборда)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-operations-per-person.ts', hint: 'operations.per_person_self_view.enabled kill-switch (ТЗ-2 Ф4 self-view /me/weekly-per-person)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-me-widgets.ts', hint: 'me.daily_value_widgets.enabled kill-switch (ТЗ-2 Ф5 виджеты /me: /me/ideas + /me/recognitions)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-portfolio-health.ts', hint: 'portfolio.health.{threshold_*,weight_*} + operations.portfolio_health.enabled kill-switch (ТЗ-2 Ф6.A здоровье портфеля целей)' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-document-attribution.ts', hint: 'documents.ai_attribution.enabled kill-switch (ТЗ-4 Ф10 LLM-подсказка атрибуции документа: docType + тема)' },
  { phase: 'seed-base', script: 'scripts/seed-badges.ts' },
  { phase: 'seed-base', script: 'scripts/seed-global-channels.ts' },
  { phase: 'seed-base', script: 'scripts/seed-knowledge-groups.ts', hint: 'группы доступа: Руководство/Совет + department-группы + leadership-членство (Ф2 knowledge-access)' },
  // ТЗ 2026-06-09 support-desk Ф1 — Support-проект (states+SLA) + закрытый
  // контур поддержки. Оба no-op без AdminSetting `support.vendor_org_id`
  // (параметр владельца). Идемпотентны.
  { phase: 'seed-base', script: 'scripts/seed-support-project.ts', hint: 'Support-проект SUP + 6 states + SupportSlaPolicy (TZ support-desk Ф1); no-op без support.vendor_org_id' },
  { phase: 'seed-base', script: 'scripts/seed-support-contour-group.ts', hint: 'закрытый контур поддержки KnowledgeGroup(kind=support) (TZ support-desk); no-op без support.vendor_org_id' },
  { phase: 'seed-base', script: 'scripts/seed-admin-setting-support.ts', hint: 'support_critic_min_groundedness=0.6 (R-INV-5) + support_promote_min_csat=4 (TZ support-desk Ф3 гейт промоута R-INV-2)' },

  // === LLM TaskRoutes для всех новых taskType (35 скриптов) ===
  ...[
    'phase-B', 'phase-C', 'phase-D', 'phase-E',
    'regulations', 'knowledge-clone', 'knowledge-core',
    'decisions', 'insights', 'ideas-and-probe',
    'skill-and-clone', 'skill-concept', 'chat-v2',
    'recognition', 'helpfulness',
    'beta-8', 'beta-8-1', 'beta-8-2', 'beta-8-3',
    'axis-classify', 'brand-voice', 'company-foundation',
    'concierge', 'cross-functional', 'experiments',
    'process-template', 'role-map', 'orchestrator', 'proactive',
    'tracker-phase3', 'tracker-phase3-c', 'tracker-phase4-telegram',
    'feedback-cluster', 'clone-v2', 'specialists-combined',
    'dialog-layer', 'temporal', 'kie-grsai-ab',
    // Query Understanding Волна 1 — extract-plan route (deepseek-v4-flash primary, Р9)
    'dialog-extract-plan',
    // Sprints (2026-05-27) — Specialist 3-13 (Помощник по спринтам).
    'sprints',
    // Agents v2 (2026-05-30) — Фаза 0.1 probe-response-classify;
    // в следующих волнах сюда добавятся остальные taskType.
    'agents-v2',
    // Pulse Wave 3 (2026-05-30) — team-health-analyzer / reflection-quality-scorer / hr-recommender.
    'pulse-w3',
    // Pulse Wave 4 (2026-05-30 §4.4) — meeting-speaker-analyzer (per-speaker text sentiment).
    'pulse-w4',
    // Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema
    // (table-infer-schema / table-architect-pass / table-entity-check).
    'smart-tables',
    // Action Center A1 «лестница доверия» (2026-06-02) — curation-verify
    // (debate-curation-verify[-critic|-supporter|-neutral]).
    'curation',
    // Goals OKR v2 (2026-06-02, Фаза 2) — Specialist 3-14 (Goals):
    // goal-extract / goal-hierarchy-link / goals-pulse-summarize.
    'goals',
    // Ф5 Р2 (2026-06-08) — task-dedupe (семантический дедуп задач встречи).
    'task-dedupe',
    // Ф4.1 (2026-06-08) — goal-task-link (LLM-привязка задач встречи к AI-цели,
    // DEFAULT OFF). Маршрут нужен заранее, иначе при включении флага вызов
    // поедет по аварийному DEFAULT_FALLBACK_CHAIN.
    'goal-task-link',
    // Support desk Ф3 (TZ 2026-06-09 support-desk-clone) — клон техподдержки:
    // support-clone-draft (Pro capable) + support-answer-critic /
    // support-edit-classify (flash cheap judge, Б9).
    'support',
    // Волна 6 Стадия C, A7 (2026-06-10) — compile-org-document (агент-компилятор
    // contentMd орг-документа; capable + tool-use). Без маршрута поедет по
    // DEFAULT_FALLBACK_CHAIN; явный seed фиксирует deepseek-v4-pro primary.
    'compile-org-document',
  ].map<Step>((sub) => ({
    phase: 'seed-llm-routes',
    script: `scripts/seed-llm-task-routes-${sub}.ts`,
  })),

  // 2026-06-05 — сид «потерянных» taskType: 5 шт. (knowledge-specialists-combined /
  // dialog-multi-query-clone / checkin-sentiment-batch / experiment-extract /
  // experiment-summarize-lessons) зарегистрированы в ALL_LLM_TASK_TYPES, но не
  // покрыты ни одним seed → 0 маршрутов. Цепочка deepseek → openai → kie. Идемпотентен.
  {
    phase: 'seed-llm-routes',
    script: 'scripts/seed-llm-task-routes-missing-registry.ts',
    hint: '5 потерянных taskType (specialists-combined/dialog-mq-clone/checkin-batch/experiment-*)',
  },

  // === Глобальный default: DeepSeek-V4-Pro primary на все taskType ===
  { phase: 'seed-llm-default', script: 'scripts/seed-llm-default-primary-deepseek-pro.ts' },
  // 2026-06-05 — нормализация всех глобальных цепочек к стандарту
  // deepseek → openai(gpt) → kie + вывод устаревшей gpt-4o. БЕЗ --force
  // (steady-state уважает editedByAdmin); разовый --force владелец гоняет
  // вручную при выкате. Идемпотентен.
  {
    phase: 'seed-llm-default',
    script: 'scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts',
    hint: 'нормализация к deepseek→openai→kie, вывод gpt-4o (БЕЗ --force: steady-state)',
  },

  // === Patch-скрипты (только для UPDATE — на чистой БД пропускаем) ===
  { phase: 'patch', script: 'scripts/patch-rename-client-to-customer.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-migrate-entity-custom-to-topic.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-document.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-goal.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-person.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-person-relationship.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-card-versions.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-document-use-cases-default.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-team-templates-ru.ts', hint: 'русификация ролей шаблона продаж (SDR→квалификация, BANT/CHAMP→методика)', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-org-timezone-default.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-person-timezone-default.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-migrate-mvs-to-company-profile.ts', args: ['--apply'], skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-migrate-person-role-to-appointment.ts', args: ['--apply'], skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-skill-trait-categories-from-strings.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-bitemporal-backfill.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-clones-role-versioning.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-clones-dataclass-update.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-dataclass-audit.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-channel-binding-defaults.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-extract-strong-ids.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-prompt-block-ingest-v2-fase0b.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-prompt-role-profile-build-fase0d.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-chat-v2-to-pro.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-mass-migrate-to-deepseek-pro.ts', args: ['--update-existing'], skipBootstrap: true },
  // 2026-06-03 — унификация дешёвой модели DeepSeek: все LlmTaskRoute с legacy
  // `deepseek-chat` → `deepseek-v4-flash` (DeepSeek-V4). Идемпотентен (skip
  // editedByAdmin; повторный прогон = 0 кандидатов). На чистом старте сиды уже
  // пишут flash → нечего мигрировать → skipBootstrap. Контекст: probe показал,
  // что DeepSeek не поддерживает response_format=json_schema (см. deepseek.service.ts).
  {
    phase: 'patch',
    script: 'scripts/patch-deepseek-chat-to-flash.ts',
    args: ['--apply'],
    hint: 'deepseek-chat → deepseek-v4-flash во всех LlmTaskRoute',
    skipBootstrap: true,
  },
  // 2026-06-03 — восстановить secondary/tertiary fallback для meeting-report-fast
  // (нормализованный primary затенял legacy 3-провайдерную цепочку → single-provider timeout)
  { phase: 'patch', script: 'scripts/patch-ensure-meeting-report-fast-fallback.ts', hint: 'fallback openai+ollama для meeting-report-fast', skipBootstrap: true },
  // 2026-06-07 Ф6 agent-chain-overhaul — вернуть цепочку отчёта на DeepSeek (кэш).
  // На проде summary/report-by-type/tasks ушли на MiniMax (0% кэш); DeepSeek
  // кэширует 81-99% без ручного cache_control. Идемпотентен (всегда update до
  // DeepSeek). На чистом старте дефолтный сид уже пишет DeepSeek → skipBootstrap.
  { phase: 'patch', script: 'scripts/patch-llm-routes-report-chain-deepseek.ts', hint: 'summary/report-by-type/tasks → DeepSeek (кэш)', skipBootstrap: true },
  // 2026-06-08 Ship-On (ТЗ enable-shipped-features-by-default Ф3) — перевести
  // готовые AdminSetting-флаги в true на существующем проде (seed их не
  // перезатирает). Уважает admin-override (updatedBy != null → no-op). Идемпотентен.
  { phase: 'patch', script: 'scripts/patch-enable-shipped-flags.ts', skipBootstrap: true, hint: 'Ship-On: включить готовые фичи (meetingTasksToTrackerOnly, tables_text_to_schema, curationAutotuneEnabled)' },
  // 2026-06-08 TZ-1 Фаза 0 (daily-value-engine) — владелец авторизовал доставку
  // дайджестов в Telegram. Флипает operations.daily_digest.deliver_to_telegram +
  // goals.pulse.deliver_to_telegram → true (уважает admin-override). Идемпотентен.
  { phase: 'patch', script: 'scripts/patch-enable-telegram-digests.ts', skipBootstrap: true, hint: 'включить доставку дайджестов COO + пульса целей в Telegram (TZ-1 Ф0)' },
  // safe to run всегда (idempotent, no-op если нет existing Appointment'ов)
  { phase: 'patch', script: 'scripts/patch-migrate-clone-access.ts', hint: 'миграция грантов перед CLONE_V2_ENABLED=true' },
  // 2026-05-26 — регистрация глобального Telegram-бота в прокси
  // telegram.crossmark.ru. Идемпотентен. Требует уже настроенного токена
  // в /admin/system/telegram-bot (на чистом старте — no-op с инструкцией).
  // ТЗ: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md.
  { phase: 'patch', script: 'scripts/patch-telegram-register-in-proxy.ts', hint: 'регистрация бота в telegram.crossmark.ru', skipBootstrap: true },
  // 2026-05-27 — ребренд Z → Кора: обновляет subject/body email-шаблонов в БД.
  // Промпты обновляет seed-prompt-templates.ts (уже в seed-llm-core).
  { phase: 'patch', script: 'scripts/patch-rebrand-z-to-kora.ts', hint: 'ребренд Z → Кора в EmailTemplate', skipBootstrap: true },
  // 2026-05-29 — audit Б1: перегенерация одноразовых паролей в pending
  // OrgInvitation (sha256→argon2id). Идемпотентен (skip уже argon2).
  // ТЗ: plans/tz/2026-05-29-audit-fixes.md §Б1.
  { phase: 'patch', script: 'scripts/patch-rehash-pending-invitations.ts', hint: 'sha256→argon2id для tempPasswordHash', skipBootstrap: true },
  // 2026-05-29 — audit Б3: проставить externalSource='demo' для legacy
  // demo-кабинетов (Org.demoWorkspaceSeededAt IS NOT NULL). Без этого
  // reset-demo на legacy-Org ничего не удалит (поле было null). Идемпотентен.
  // ТЗ: plans/tz/2026-05-29-audit-fixes.md §Б3.
  { phase: 'patch', script: 'scripts/patch-mark-demo-data.ts', hint: 'backfill externalSource=demo для existing demo-Org', skipBootstrap: true },
  // 2026-05-29 — audit Б5: шифрование plain OAuth-токенов Точки в БД.
  // Требует CRYPTO_MASTER_KEY в ENV. Идемпотентен. ТЗ §Б5.
  { phase: 'patch', script: 'scripts/patch-encrypt-tochka-oauth.ts', hint: 'AES-256-GCM для tochka oauth tokens', skipBootstrap: true },
  // 2026-05-29 — audit Б7: dedupe ДО добавления @@unique. Иначе prisma:push
  // упадёт на существующих дублях. Идемпотентны. ТЗ §Б7.
  { phase: 'patch', script: 'scripts/patch-dedupe-billing-event-log.ts', hint: 'dedupe BillingEventLog по (providerName,externalEventId)', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-dedupe-referral-payout.ts', hint: 'dedupe ReferralPayout по triggerInvoiceId', skipBootstrap: true },
  // 2026-05-29 — audit Б8: backfill ReferralAttribution.dateBucket +
  // dedupe по (referralId, fingerprint, dateBucket) ДО prisma:push с
  // composite unique. Идемпотентен. ТЗ §Б8.
  { phase: 'patch', script: 'scripts/patch-backfill-referral-attribution-date-bucket.ts', hint: 'backfill dateBucket + dedupe для composite unique', skipBootstrap: true },
  // 2026-05-29 — telegram-self-initiated-checkins Фаза 3: backfill DailyCheckIn.source.
  // После prisma:push все записи получили default 'cron_prompted'. Manual create через
  // POST /me/check-ins (notificationId IS NULL) перевешиваем в 'manual'. Идемпотентен.
  // ТЗ: plans/tz/2026-05-29-telegram-self-initiated-checkins.md.
  {
    phase: 'patch',
    script: 'scripts/patch-daily-checkin-backfill-source.ts',
    hint: 'backfill source=manual для DailyCheckIn без notificationId',
    skipBootstrap: true,
  },
  // 2026-05-29 — audit Б12: incident-only откат LLM-миграции
  // deepseek-v4-pro → deepseek-v4-flash. НЕ запускается агрегатором
  // ни в bootstrap, ни в update — только руками при инциденте:
  //   docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run
  //   docker compose exec backend bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
  // Регистрация здесь — для discoverability и единого реестра.
  // ТЗ: plans/tz/2026-05-29-audit-fixes.md §Б12.
  {
    phase: 'patch',
    script: 'scripts/patch-rollback-to-deepseek-flash.ts',
    hint: 'INCIDENT-ONLY: rollback deepseek-v4-pro → flash, запускать руками',
    skipBootstrap: true,
    skipUpdate: true,
  },
  // 2026-05-29 — audit С31: verify-скрипт. Проверяет, нет ли email-конфликтов
  // между путями /login (standalone vs admin) и role/hash format mismatches.
  // ТОЛЬКО dry-run-read (без --fix) — fix руками после консультации.
  // Полезно после первого деплоя UnifiedLoginController и после массовых
  // изменений User-таблицы.
  {
    phase: 'patch',
    script: 'scripts/patch-audit-user-email-conflicts.ts',
    hint: 'verify (dry-run-only): email/role конфликты в User',
    skipBootstrap: true,
    skipUpdate: true,
  },
  // 2026-05-27 — billing-tochka-referral-dadata-z: миграция legacy
  // tier_basic/tier_pro/tier_enterprise → tier_standard на всех OrgEntitlement.
  // Идемпотентен. ТЗ §14 Фаза 1.4.
  {
    phase: 'patch',
    script: 'scripts/migrate-entitlements-to-standard.ts',
    hint: 'legacy tier → tier_standard',
    skipBootstrap: true,
  },
  // 2026-06-01 — shared-demo-org-model: создать эталонную Demo-Org «ТехноСтрим»
  // и подключить ZDEMO_ORG_ID в ENV. Идемпотентен (skip если уже создан).
  // Печатает ZDEMO_ORG_ID=<cuid> — программист руками вставляет в .env.
  // ТЗ: plans/tz/2026-06-01-demo-shared-org-model.md §6.1.
  {
    phase: 'patch',
    script: 'scripts/patch-create-reference-demo-org.ts',
    hint: 'эталонная Demo-Org «ТехноСтрим» + ZDEMO_ORG_ID',
    skipBootstrap: false, // Нужен и для bootstrap, и для update — это создаёт сам эталон.
  },
  // 2026-06-01 — миграция existing «копий ТехноСтрим» в shared-модель:
  // очищаем демо-данные у Org с demoWorkspaceSeededAt != null И не-isReferenceDemo,
  // прикрепляем owner'ов наблюдателями к эталону. Требует ZDEMO_ORG_ID в ENV.
  // ТЗ: plans/tz/2026-06-01-demo-shared-org-model.md §6.2.
  {
    phase: 'patch',
    script: 'scripts/patch-migrate-old-demo-orgs.ts',
    hint: 'миграция старых «копий ТехноСтрим» → demo_observer наблюдатели',
    skipBootstrap: true, // На чистой БД нечего мигрировать.
  },
  // 2026-06-03 — фикс egress-фантомов: вебхук participant_joined создавал
  // Participant'ов для egress-рекордеров (identity не host:/guest:). Чистим
  // накопленное (Participant + их MeetingParticipantBehavior). Идемпотентен.
  {
    phase: 'patch',
    script: 'scripts/patch-cleanup-egress-phantom-participants.ts',
    hint: 'удалить фантомных Participant с identity не host:/guest: (egress)',
    skipBootstrap: true, // На чистой БД фантомов нет.
  },
  // 2026-06-06 — Ф8 (knowledge-access-groups-and-provenance): дефолт закрытости
  // типа встречи interview → 'personal' (В6). На чистом старте bootstrap-sync
  // создаёт interview с этим дефолтом сам → skipBootstrap. На проде, где
  // bootstrap прошёл до фичи, строка interview имеет NULL — патч добивает.
  // Идемпотентен (WHERE defaultClosedGroupKind IS NULL, safe-seed override).
  // ТЗ: plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md Фаза 8.
  {
    phase: 'patch',
    script: 'scripts/patch-meeting-type-closed-defaults.ts',
    hint: 'interview → defaultClosedGroupKind=personal (Ф8 knowledge-access)',
    skipBootstrap: true,
  },

  // === Backfill ===
  { phase: 'backfill', script: 'scripts/backfill-meeting-sources-fase1.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-entity-link-types-fase0.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-commitment-due-dates.ts', skipBootstrap: true },
  // TZ-1 Ф3.B (daily-value-engine) — засеять DecisionTaskLink из пересечения
  // sourceBlockIds (Decision×Issue) + пересчитать Decision.linkedTaskCount.
  // Идемпотентно (skipDuplicates). На чистом старте — no-op → skipBootstrap.
  { phase: 'backfill', script: 'scripts/backfill-decision-linked-task-count.ts', hint: 'Decision.linkedTaskCount + DecisionTaskLink из sourceBlockIds (TZ-1 Ф3.B)', skipBootstrap: true },
  // Tracker Boards (2026-05-27) — каждому проекту нужна default-доска
  // (`Board { isDefault: true }`), и все issues с boardId=NULL должны быть
  // привязаны к ней. Идемпотентно. ТЗ: plans/tz/2026-05-27-tracker-boards.md.
  { phase: 'backfill', script: 'scripts/backfill-default-board.ts', hint: 'default Board + issues.boardId backfill', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-system-generated-projects.ts', hint: 'пометить org-контейнеры «Спринт компании» systemGenerated=true (A6)', skipBootstrap: true },
  // 2026-06-10 Волна 6 A10 — переклассификация single-role Process → Instruction
  // (first-class «Инструкция»). Идемпотентен (skip по tenantId+name), dry-run по
  // умолчанию → нужен `--apply`. На чистом старте инструкций нет → skipBootstrap.
  { phase: 'backfill', script: 'scripts/backfill-reclassify-instructions.ts', args: ['--apply'], hint: 'Process scope=role:* → Instruction (A10)', skipBootstrap: true },
  {
    phase: 'backfill',
    script: 'scripts/backfill-onboarding-setup-completed.ts',
    hint: 'Онбординг v2: выставляет setupCompletedAt для Org с отделами',
    skipBootstrap: false,
  },
  // 2026-05-27 — billing Фаза 3: стартовый MeetingsBalance(balance=150)
  // для всех existing Org (заменяет ушедшую квоту meetings_per_month).
  // Идемпотентен (where: meetingsBalance: null).
  {
    phase: 'backfill',
    script: 'scripts/backfill-meetings-balance.ts',
    hint: 'стартовый MeetingsBalance=150 для всех Org',
    skipBootstrap: true,
  },

  // ТЗ paywall-no-trial Фаза 5.1: создать Subscription{status=DEMO} для
  // всех Org, у которых её ещё нет (grandfather перед paywall).
  {
    phase: 'backfill',
    script: 'scripts/backfill-demo-subscriptions.ts',
    hint: 'DEMO-подписка для Org, существовавших до paywall',
    skipBootstrap: true,
  },

  // 2026-05-29 — Фаза 0.5 (agents-v2-umbrella): после router fix
  // `expertise|experience|competence` теперь идут также в 3-2-knowledge-clone.
  // Old блоки уже в графе, но KnowledgeProfile сотрудников по ним не пересобирался —
  // enqueue ребилд для employee'ев с такими canonical-блоками. Idempotent
  // (jobId + debounce). На свежем prod нечего бэкфилить → skipBootstrap.
  // ТЗ: plans/tz/2026-05-29-agents-v2-umbrella.md §Фаза 0.5.
  {
    phase: 'backfill',
    script: 'scripts/backfill-knowledge-clone-after-router-fix.ts',
    hint: 'enqueue KnowledgeProfile rebuild для employee с expertise/experience/competence блоками (after router fix Фаза 0.5)',
    skipBootstrap: true,
  },

  // 2026-05-30 — Agents v2 Фаза A1: bi-temporal edges. После prisma:push
  // в IdeaBlockLink добавлены поля validFrom / validUntil. Backfill:
  // legacy-записи получают validFrom = createdAt, validUntil = NULL
  // (открытый интервал). Идемпотентен (WHERE validFrom IS NULL). Нужен
  // и для fresh (на случай записей из seed'ов), и для upgrade.
  // ТЗ: plans/tz/2026-05-29-agents-v2-umbrella.md §A1.
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
  // Smart-tables Фаза 2 — graph-driven rows: наполнить системные autoCreate-таблицы
  // строками по «живым» Entity графа (customer/vendor/person/document).
  // Идемпотентен (skip привязанных entityId + конфликт-резолвер ручных строк).
  // Должен идти ПОСЛЕ backfill-system-tables (таблицы уже созданы).
  {
    phase: 'backfill',
    script: 'scripts/backfill-table-entity-sync.ts',
    hint: 'Smart-tables Фаза 2: graph-driven строки в системные autoCreate-таблицы',
    skipBootstrap: true,
  },
  // Goals OKR v2 (2026-06-02) Фаза 0 — после prisma:push legacy-цели получили
  // recordedAt=now() от @default(now()). Backfill выставляет recordedAt=createdAt
  // живым версиям (validUntil/supersededById IS NULL). Идемпотентен. На чистом
  // старте целей нет → skipBootstrap. ТЗ: plans/tz/2026-06-02-goals-okr-v2.md §2.5.
  {
    phase: 'backfill',
    script: 'scripts/backfill-goal-v2-defaults.ts',
    hint: 'Goals OKR v2: recordedAt=createdAt для legacy-целей',
    args: ['--apply'],
    skipBootstrap: true,
  },
  // 2026-06-04 — Ф9 (no_person): Person для владельцев Org без Person
  // (Membership.personId IS NULL). Создаёт минимальную карточку
  // (relationship=employee, name/email из User) и проставляет personId.
  // Чинит me/promises 403 и legacy-ветку dump. Идемпотентен. На чистом
  // старте нет legacy Org → skipBootstrap.
  // ТЗ: plans/tz/2026-06-04-razblokirovka-konveyera.md §Ф9.
  {
    phase: 'backfill',
    script: 'scripts/backfill-owner-person.ts',
    args: ['--apply'],
    hint: 'Person для владельцев Org без Person (Ф9)',
    skipBootstrap: true,
  },
  // 2026-06-04 — Ф1.3 (meeting-identity-and-clones-attribution): атрибуция
  // role='subject' для ИСТОРИЧЕСКИХ canonical-блоков семейства reasoning
  // (Фаза 1.2 покрывает только новые). Находит автора через source-RawEvent
  // (meeting: сегмент/спикер; text: payload.userId), upsert IdeaBlockEntity
  // role='subject' + ре-enqueue core.skill-profile-rebuild для employee-Person.
  // Идемпотентен (upsert по PK + дедуп enqueue по personId). На чистом старте
  // нет исторических блоков → skipBootstrap. Уважает kill-switch
  // knowledge.subjectAttributionEnabled.
  // ТЗ: plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md §1.3.
  {
    phase: 'backfill',
    script: 'scripts/backfill-subject-attribution.ts',
    hint: 'role=subject для исторических reasoning-блоков + rebuild клонов (Ф1.3)',
    skipBootstrap: true,
  },
  // 2026-06-06 — Ф1 (knowledge-access-groups-and-provenance): расширение
  // subject-атрибуции на ВСЕ типы знания (не только reasoning) + per-adapter
  // identity (tracker/chatbox/dump/email). Добивает role='subject' для
  // исторических canonical-блоков любого типа без subject-связи. Идемпотентен
  // (кандидаты — только блоки без subject-связи). Уважает флаги
  // knowledge.subjectAttributionEnabled + knowledge.subjectAttributionAllTypes.
  // ТЗ: plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md Фаза 1.
  {
    phase: 'backfill',
    script: 'scripts/backfill-subject-attribution-all-types.ts',
    hint: 'role=subject для исторических блоков ВСЕХ типов + per-adapter identity (Ф1 knowledge-access)',
    skipBootstrap: true,
  },
  // 2026-06-06 — Ф3 (knowledge-access-groups-and-provenance): department-группы
  // (IdeaBlockAccess) для исторических canonical-блоков из существующих
  // functional axisLabels (+ участники/автор). closed задним числом НЕ
  // назначается (В5: историческое знание = открыто). Идемпотентен (кандидаты —
  // блоки без IdeaBlockAccess). Без --departments скрипт no-op — поэтому
  // прогон через STEPS осмысленный только с args=['--departments'].
  // ТЗ: plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md Фаза 3.
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
  // 2026-06-08 Часть B Ф3 (ТЗ enable-shipped-features-by-default) — снять ложные
  // subject=менеджер связи от chatbox (cross-attribution: реплики клиента
  // приписывались менеджеру). Скрипт по умолчанию dry-run; агрегатор запускает
  // с --apply. Идемпотентен (повтор → 0). mentioned и не-chatbox subject не трогает.
  {
    phase: 'backfill',
    script: 'scripts/backfill-chatbox-subject-cleanup.ts',
    args: ['--apply'],
    hint: 'очистка ложных subject=менеджер от chatbox (cross-attribution)',
    skipBootstrap: true,
  },

  // === Migrate (β-9 Telegram, legacy Task → Issue) ===
  { phase: 'migrate', script: 'scripts/migrate-telegram-channels-to-global.ts', skipBootstrap: true },
  { phase: 'migrate', script: 'scripts/migrate-task-to-issue.ts', args: ['--apply'], skipBootstrap: true },
];

interface ParsedArgs {
  mode: 'bootstrap' | 'update' | 'all';
  dryRun: boolean;
  continueOnFail: boolean;
  /** Прогнать schema-фазу: авто-бэкап → dedupe → prisma migrate deploy → apply-postgres-init. */
  withSchema: boolean;
  /**
   * Не падать (exit 1) из-за упавших STEP'ов в финале. Schema-фаза при сбое
   * всё равно завершает процесс с кодом 1. Нужно для `migrate`-контейнера:
   * сбой схемы должен блокировать старт backend, а осечка идемпотентного
   * seed/backfill — нет (иначе один скрипт кладёт весь стек).
   */
  failOnSteps: boolean;
  /**
   * Подробный вывод: стримить полный stdout/stderr каждого шага. По умолчанию
   * (false) — тихий режим: одна строка-итог на шаг (✓/✗ + summary), полный
   * вывод печатается ТОЛЬКО для упавших шагов. Чистый лог на идемпотентном
   * выкате. Включается `--verbose` или env `APPLY_PROD_DEPLOY_VERBOSE=1`.
   */
  verbose: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'all';
  let dryRun = false;
  let continueOnFail = false;
  let withSchema = false;
  let failOnSteps = true;
  let verbose = process.env['APPLY_PROD_DEPLOY_VERBOSE'] === '1';
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
    else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: bun run scripts/apply-prod-deploy.ts [--mode bootstrap|update|all] [--with-schema] [--dry-run] [--continue-on-fail] [--no-fail-on-steps] [--verbose]\n` +
          `  --with-schema       авто-бэкап БД → dedupe → prisma migrate deploy → apply-postgres-init,\n` +
          `                      затем обычные seed/patch/backfill. Делает выкат одной командой.\n` +
          `  --no-fail-on-steps  не падать из-за упавших seed/backfill (schema-сбой всё равно = exit 1).\n` +
          `                      Для migrate-контейнера: схема блокирует backend, осечка сида — нет.\n` +
          `  --verbose           полный вывод каждого шага (по умолчанию — тихо, 1 строка/шаг,\n` +
          `                      полный лог только у упавших). Также env APPLY_PROD_DEPLOY_VERBOSE=1.`,
      );
      process.exit(0);
    }
  }
  return { mode, dryRun, continueOnFail, withSchema, failOnSteps, verbose };
}

/**
 * Авто-бэкап БД через pg_dump ДО `prisma migrate deploy`.
 * Пишет в /app/backups (docker-volume z-backups). Если бэкап не удался —
 * возвращает false, и schema-фаза НЕ выполняет migrate (изменение схемы без
 * бэкапа недопустимо). Требует pg_dump в образе (postgresql16-client) и DATABASE_URL.
 */
async function autoBackup(): Promise<boolean> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('[schema] autoBackup: DATABASE_URL не задан — бэкап невозможен, migrate отменён.');
    return false;
  }
  const dir = '/app/backups';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${dir}/pre-deploy-${ts}.dump`;
  // eslint-disable-next-line no-console
  console.log(`\n=== AUTO-BACKUP (перед migrate deploy) → ${file} ===`);
  await Bun.spawn(['mkdir', '-p', dir], { stdout: 'inherit', stderr: 'inherit' }).exited;
  const proc = Bun.spawn(['pg_dump', url, '-Fc', '-f', file], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[schema] ✗ pg_dump упал (exit ${code}). migrate deploy НЕ выполняется без бэкапа. ` +
        `Проверь, что pg_dump есть в образе (postgresql16-client) и postgres доступен.`,
    );
    return false;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[schema] ✓ Бэкап создан: ${file}\n` +
      `         restore: docker compose run --rm --no-deps backend ` +
      `pg_restore --clean --if-exists -d "$DATABASE_URL" ${file}`,
  );
  return true;
}

/** Выполнить SQL-скаляр через psql, вернуть trimmed-строку результата (или null при ошибке). */
async function psqlScalar(url: string, sql: string): Promise<string | null> {
  const proc = Bun.spawn(['psql', url, '-tAc', sql], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    const err = await new Response(proc.stderr).text();
    // eslint-disable-next-line no-console
    console.error(`[schema] psqlScalar упал: ${err.slice(-500)}`);
    return null;
  }
  return out.trim();
}

/** Выполнить SQL-стейтмент через psql (без значения). true при успехе. */
async function psqlExec(url: string, sql: string): Promise<boolean> {
  const proc = Bun.spawn(['psql', url, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return (await proc.exited) === 0;
}

/**
 * Принудительный `search_path=public` для prisma-команд миграций.
 *
 * Из-за AGE search_path роли = `ag_catalog, "$user", public` Prisma создаёт
 * служебную `_prisma_migrations` НЕ в public (в первой схеме search_path —
 * ag_catalog), а ИЩЕТ её в public (datasource schema) → P3005. Параметр
 * `options=-c search_path=public` (поддерживается Prisma для PostgreSQL) делает
 * все операции миграций детерминированно в public. Применяется только к
 * prisma-сабпроцессам (resolve/deploy), не к psql и не к рантайму приложения.
 */
function withPublicSearchPath(url: string): string {
  if (/[?&]options=/.test(url)) return url; // уже задано — не трогаем
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}options=-c%20search_path%3Dpublic`;
}

/**
 * Авто-baseline: делает деплой hands-free для существующих БД, созданных старым
 * `db push` (без таблицы `_prisma_migrations`). Идемпотентно и безопасно —
 * срабатывает только ОДИН раз (после первого успешного прогона таблица миграций
 * уже есть, и ветка существующей-БД больше не выполняется).
 *
 * Логика (детекция schema-агностична — pg_class по всем схемам, т.к. из-за AGE
 * search_path `_prisma_migrations` может лежать не в public):
 *   1. Есть `_prisma_migrations` → ничего не делаем (обычный `migrate deploy`).
 *   2. Нет таблиц приложения (пустая БД) → ничего: `migrate deploy` создаст всё из 0_init.
 *   3. Существующая БД без `_prisma_migrations` → `migrate resolve --applied 0_init`
 *      (помечаем init применённым, SQL не выполняется). БД создана прошлым
 *      `db push` из той же `schema.prisma` → уже соответствует 0_init. P3008
 *      (уже applied) трактуется как успех (идемпотентно).
 *
 * ВАЖНО — почему БЕЗ reconcile-диффа. Схема Z РАЗДЕЛЕНА: `schema.prisma` +
 * `postgres-init.sql` (GIN/HNSW/trgm-индексы, generated-колонки `*_search_tsv`,
 * partial-индексы — Prisma их не выражает). `migrate diff --to-schema` не видит
 * объекты из postgres-init и сгенерил бы их `DROP` (false-positives), плюс
 * путается с unused-enum'ами. Поэтому diff к схеме здесь НЕЛЬЗЯ использовать для
 * выравнивания. postgres-init.sql прогоняется отдельным шагом ПОСЛЕ migrate
 * (идемпотентно пересоздаёт свои объекты). Если когда-нибудь нужен реальный
 * аддитивный fix существующей БД — это делается отдельной нормальной миграцией.
 *
 * Требует psql (postgresql16-client) и DATABASE_URL.
 */
async function ensureBaseline(): Promise<boolean> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('[schema] ensureBaseline: DATABASE_URL не задан.');
    return false;
  }

  const migrateUrl = withPublicSearchPath(url);

  // В какой схеме лежит `_prisma_migrations`? (по всем схемам; public — приоритет).
  // Из-за AGE search_path таблица миграций могла оказаться в ag_catalog.
  const migSchema = await psqlScalar(
    url,
    "SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE c.relname = '_prisma_migrations' ORDER BY (n.nspname = 'public') DESC LIMIT 1",
  );
  if (migSchema === null) return false;

  // Есть, но НЕ в public → перенести в public. Prisma migrate ищет таблицу в
  // public (datasource schema); qualified ALTER не зависит от search_path.
  if (migSchema !== '' && migSchema !== 'public') {
    // eslint-disable-next-line no-console
    console.log(`\n>>> [schema] _prisma_migrations в схеме "${migSchema}" (AGE search_path) → переношу в public.`);
    if (!(await psqlExec(url, `ALTER TABLE "${migSchema}"._prisma_migrations SET SCHEMA public`))) {
      // eslint-disable-next-line no-console
      console.error('[schema] ✗ не удалось перенести _prisma_migrations в public.');
      return false;
    }
    // eslint-disable-next-line no-console
    console.log('[schema] ✓ _prisma_migrations перенесена в public → migrate deploy применит pending.');
    return true;
  }

  // Уже в public → baseline есть.
  if (migSchema === 'public') {
    // eslint-disable-next-line no-console
    console.log('[schema] baseline есть (_prisma_migrations в public) → обычный migrate deploy.');
    return true;
  }

  // Таблицы миграций нет нигде. Пустая БД?
  const hasTables = await psqlScalar(url, `SELECT count(*) FROM pg_class WHERE relname = 'User' AND relkind = 'r'`);
  if (hasTables === null) return false;
  if (hasTables === '0') {
    // eslint-disable-next-line no-console
    console.log('[schema] пустая БД — migrate deploy создаст схему с нуля (0_init).');
    return true; // deploy идёт с forced search_path=public → _prisma_migrations в public
  }

  // Существующая БД без миграций → baseline `resolve --applied 0_init`.
  // Запускаем с forced search_path=public (migrateUrl), чтобы _prisma_migrations
  // создалась в public, а не в ag_catalog. P3008 (уже applied) = успех.
  // eslint-disable-next-line no-console
  console.log('\n>>> [schema] АВТО-BASELINE: существующая БД без _prisma_migrations → resolve --applied 0_init.');
  const resolve = Bun.spawn(['bunx', 'prisma', 'migrate', 'resolve', '--applied', '0_init'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DATABASE_URL: migrateUrl },
  });
  const resolveOut = (await new Response(resolve.stdout).text()) + (await new Response(resolve.stderr).text());
  // eslint-disable-next-line no-console
  console.log(resolveOut.trim());
  if ((await resolve.exited) !== 0) {
    if (/P3008|already recorded as applied/i.test(resolveOut)) {
      // eslint-disable-next-line no-console
      console.log('[schema] 0_init уже отмечен applied (P3008) — продолжаем.');
      return true;
    }
    // eslint-disable-next-line no-console
    console.error('[schema] ✗ migrate resolve --applied 0_init упал.');
    return false;
  }
  // eslint-disable-next-line no-console
  console.log('[schema] ✓ авто-baseline завершён.');
  return true;
}

/**
 * Schema-фаза (--with-schema): авто-бэкап → pre-migrate dedupe (чтобы unique не
 * упали на дублях) → авто-baseline → prisma migrate deploy → apply-postgres-init.
 * Возвращает false при фатальной ошибке (бэкап/migrate), чтобы main остановился.
 *
 * С 2026-06-05 схема применяется версионируемыми миграциями (`prisma migrate
 * deploy`), а НЕ `db push`. `migrate deploy` применяет только новые файлы из
 * `prisma/migrations/` транзакционно — без класса «частичных/дрейфующих»
 * состояний, которые давал `db push --accept-data-loss`. Деструктивные шаги
 * теперь ревьюятся в самом файле миграции.
 *
 * **Деплой полностью автоматический.** `ensureBaseline()` сам определяет
 * состояние БД и при первом запуске на существующей (db-push'нутой) базе без
 * `_prisma_migrations` аддитивно подравнивает дрейф и помечает 0_init applied —
 * никаких ручных шагов. Дальше — всегда просто `migrate deploy`.
 */
async function runSchemaPhase(dryRun: boolean, continueOnFail: boolean, verbose: boolean): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.log('\n=== SCHEMA PHASE (--with-schema) ===');
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      '>>> [schema] (dry-run) auto-backup + dedupe + auto-baseline + prisma migrate deploy + apply-postgres-init',
    );
    return true;
  }

  // 1. Авто-бэкап — обязателен перед изменением схемы. Не удался → не мигрируем.
  if (!(await autoBackup())) return false;

  // 2. Pre-migrate dedupe — ДО создания unique-констрейнтов (Б7), иначе migrate
  //    упадёт на существующих дублях. dateBucket-дедуп (Б8) идёт позже в
  //    patch-фазе: его колонку создаёт сама миграция.
  const preDedupe: Step[] = [
    { phase: 'patch', script: 'scripts/patch-dedupe-billing-event-log.ts' },
    { phase: 'patch', script: 'scripts/patch-dedupe-referral-payout.ts' },
  ];
  for (const s of preDedupe) {
    const r = await runOne(s, false, verbose);
    if (!r.ok && !continueOnFail) return false;
  }

  // 2.5. Авто-baseline существующей БД (одноразово, идемпотентно). Делает деплой
  //      hands-free: переводит db-push'нутую базу под управление миграций без
  //      ручных команд. Подробности — в ensureBaseline().
  if (!(await ensureBaseline())) return false;

  // 3. prisma migrate deploy (бэкап уже сделан выше). Применяет только новые
  //    миграции из prisma/migrations/. Идемпотентно: если новых нет — no-op.
  //    DATABASE_URL с forced search_path=public — чтобы `_prisma_migrations`
  //    создавалась/читалась в public (а не в ag_catalog из-за AGE search_path).
  const dbUrl = process.env['DATABASE_URL'];
  // eslint-disable-next-line no-console
  console.log('\n>>> [schema] bunx prisma migrate deploy');
  const push = Bun.spawn(['bunx', 'prisma', 'migrate', 'deploy'], {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(dbUrl ? { env: { ...process.env, DATABASE_URL: withPublicSearchPath(dbUrl) } } : {}),
  });
  if ((await push.exited) !== 0) return false; // migrate критичен — всегда стоп

  // 4. postgres-init (HNSW/GIN/extensions/partial-unique).
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

/**
 * Вытащить из stdout одну информативную строку-итог (counts), чтобы показать её
 * рядом с ✓ в тихом режиме. Берём ПОСЛЕДНюю строку с числами-итогами; служебные
 * `=== … START/DONE ===`-обёртки пропускаем.
 */
function pickSummaryLine(out: string): string {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const re = /(inserted|created|updated|skipped|applied|patched|scanned|deleted|backfilled|voided|protected)/i;
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
    // eslint-disable-next-line no-console
    console.log(`>>> ${label}`);
    return { ok: true, code: 0 };
  }

  // Verbose — стримим как раньше (для отладки конкретного шага).
  if (verbose) {
    // eslint-disable-next-line no-console
    console.log(`\n>>> ${label}`);
    const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
    const code = await proc.exited;
    return { ok: code === 0, code };
  }

  // Тихий режим (по умолчанию): захватываем вывод, печатаем 1 строку-итог.
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code === 0) {
    const summary = pickSummaryLine(out);
    // eslint-disable-next-line no-console
    console.log(`✓ ${label}${summary ? `  — ${summary}` : ''}`);
    return { ok: true, code };
  }
  // Упал — печатаем полный вывод для отладки.
  // eslint-disable-next-line no-console
  console.error(`\n✗ ${label}  (exit ${code})`);
  if (out.trim()) {
    // eslint-disable-next-line no-console
    console.error(out.trimEnd());
  }
  if (err.trim()) {
    // eslint-disable-next-line no-console
    console.error(err.trimEnd());
  }
  return { ok: false, code };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const steps = filterSteps(STEPS, args.mode);

  // eslint-disable-next-line no-console
  console.log(
    `=== apply-prod-deploy mode=${args.mode} withSchema=${args.withSchema} dryRun=${args.dryRun} steps=${steps.length} ===`,
  );

  // Schema-фаза (--with-schema) — ДО seed/patch/backfill: бэкап + push + init.
  if (args.withSchema) {
    const ok = await runSchemaPhase(args.dryRun, args.continueOnFail, args.verbose);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error('\n✗ SCHEMA PHASE упала (бэкап или push). Остановка — данные не тронуты.');
      process.exit(1);
    }
  }

  const results: { step: Step; ok: boolean; code: number }[] = [];
  for (const step of steps) {
    const r = await runOne(step, args.dryRun, args.verbose);
    results.push({ step, ...r });
    if (!r.ok && !args.continueOnFail) {
      // eslint-disable-next-line no-console
      console.error(`\n✗ ${step.script} упал (exit ${r.code}). Остановка (используй --continue-on-fail чтобы продолжать).`);
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\n=== SUMMARY ===`);
  // eslint-disable-next-line no-console
  console.log(`Всего: ${results.length}, OK: ${results.length - failed.length}, FAIL: ${failed.length}`);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.log(`\nУпавшие:`);
    for (const f of failed) {
      // eslint-disable-next-line no-console
      console.log(`  ✗ ${f.step.script} (exit ${f.code})`);
    }
    if (args.failOnSteps) {
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n⚠ ${failed.length} step(s) упали, но --no-fail-on-steps → выходим 0 ` +
        `(схема применена, backend может стартовать; перезапусти скрипты по списку выше).`,
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`✓ ALL APPLIED`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('apply-prod-deploy FAILED:', err);
  process.exit(1);
});
