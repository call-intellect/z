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
  { phase: 'seed-base', script: 'scripts/seed-badges.ts' },
  { phase: 'seed-base', script: 'scripts/seed-global-channels.ts' },

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
  ].map<Step>((sub) => ({
    phase: 'seed-llm-routes',
    script: `scripts/seed-llm-task-routes-${sub}.ts`,
  })),

  // === Глобальный default: DeepSeek-V4-Pro primary на все taskType ===
  { phase: 'seed-llm-default', script: 'scripts/seed-llm-default-primary-deepseek-pro.ts' },

  // === Patch-скрипты (только для UPDATE — на чистой БД пропускаем) ===
  { phase: 'patch', script: 'scripts/patch-rename-client-to-customer.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-migrate-entity-custom-to-topic.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-document.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-goal.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-entity-id-person.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-person-relationship.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-backfill-card-versions.ts', skipBootstrap: true },
  { phase: 'patch', script: 'scripts/patch-document-use-cases-default.ts', skipBootstrap: true },
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

  // === Backfill ===
  { phase: 'backfill', script: 'scripts/backfill-meeting-sources-fase1.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-entity-link-types-fase0.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-commitment-due-dates.ts', skipBootstrap: true },
  // Tracker Boards (2026-05-27) — каждому проекту нужна default-доска
  // (`Board { isDefault: true }`), и все issues с boardId=NULL должны быть
  // привязаны к ней. Идемпотентно. ТЗ: plans/tz/2026-05-27-tracker-boards.md.
  { phase: 'backfill', script: 'scripts/backfill-default-board.ts', hint: 'default Board + issues.boardId backfill', skipBootstrap: true },
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

  // === Migrate (β-9 Telegram, legacy Task → Issue) ===
  { phase: 'migrate', script: 'scripts/migrate-telegram-channels-to-global.ts', skipBootstrap: true },
  { phase: 'migrate', script: 'scripts/migrate-task-to-issue.ts', args: ['--apply'], skipBootstrap: true },
];

interface ParsedArgs {
  mode: 'bootstrap' | 'update' | 'all';
  dryRun: boolean;
  continueOnFail: boolean;
  /** Прогнать schema-фазу: авто-бэкап → dedupe → prisma db push --accept-data-loss → apply-postgres-init. */
  withSchema: boolean;
  /**
   * Не падать (exit 1) из-за упавших STEP'ов в финале. Schema-фаза при сбое
   * всё равно завершает процесс с кодом 1. Нужно для `migrate`-контейнера:
   * сбой схемы должен блокировать старт backend, а осечка идемпотентного
   * seed/backfill — нет (иначе один скрипт кладёт весь стек).
   */
  failOnSteps: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'all';
  let dryRun = false;
  let continueOnFail = false;
  let withSchema = false;
  let failOnSteps = true;
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
    else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: bun run scripts/apply-prod-deploy.ts [--mode bootstrap|update|all] [--with-schema] [--dry-run] [--continue-on-fail] [--no-fail-on-steps]\n` +
          `  --with-schema       авто-бэкап БД → dedupe → prisma db push --accept-data-loss → apply-postgres-init,\n` +
          `                      затем обычные seed/patch/backfill. Делает выкат одной командой.\n` +
          `  --no-fail-on-steps  не падать из-за упавших seed/backfill (schema-сбой всё равно = exit 1).\n` +
          `                      Для migrate-контейнера: схема блокирует backend, осечка сида — нет.`,
      );
      process.exit(0);
    }
  }
  return { mode, dryRun, continueOnFail, withSchema, failOnSteps };
}

/**
 * Авто-бэкап БД через pg_dump ДО `prisma db push --accept-data-loss`.
 * Пишет в /app/backups (docker-volume z-backups). Если бэкап не удался —
 * возвращает false, и schema-фаза НЕ выполняет push (data-loss без бэкапа
 * недопустим). Требует pg_dump в образе (postgresql16-client) и DATABASE_URL.
 */
async function autoBackup(): Promise<boolean> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('[schema] autoBackup: DATABASE_URL не задан — бэкап невозможен, push отменён.');
    return false;
  }
  const dir = '/app/backups';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `${dir}/pre-deploy-${ts}.dump`;
  // eslint-disable-next-line no-console
  console.log(`\n=== AUTO-BACKUP (перед --accept-data-loss) → ${file} ===`);
  await Bun.spawn(['mkdir', '-p', dir], { stdout: 'inherit', stderr: 'inherit' }).exited;
  const proc = Bun.spawn(['pg_dump', url, '-Fc', '-f', file], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[schema] ✗ pg_dump упал (exit ${code}). --accept-data-loss НЕ выполняется без бэкапа. ` +
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

/**
 * Schema-фаза (--with-schema): авто-бэкап → pre-push dedupe (чтобы unique не
 * упали на дублях) → prisma db push --accept-data-loss → apply-postgres-init.
 * Возвращает false при фатальной ошибке (бэкап/push), чтобы main остановился.
 */
async function runSchemaPhase(dryRun: boolean, continueOnFail: boolean): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.log('\n=== SCHEMA PHASE (--with-schema) ===');
  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      '>>> [schema] (dry-run) auto-backup + dedupe + prisma db push --accept-data-loss + apply-postgres-init',
    );
    return true;
  }

  // 1. Авто-бэкап — обязателен перед data-loss. Не удался → не пушим.
  if (!(await autoBackup())) return false;

  // 2. Pre-push dedupe — ДО создания unique-констрейнтов (Б7), иначе push
  //    упадёт на существующих дублях. dateBucket-дедуп (Б8) идёт позже в
  //    patch-фазе: его колонку создаёт сам push.
  const preDedupe: Step[] = [
    { phase: 'patch', script: 'scripts/patch-dedupe-billing-event-log.ts' },
    { phase: 'patch', script: 'scripts/patch-dedupe-referral-payout.ts' },
  ];
  for (const s of preDedupe) {
    const r = await runOne(s, false);
    if (!r.ok && !continueOnFail) return false;
  }

  // 3. prisma db push --accept-data-loss (бэкап уже сделан выше).
  // eslint-disable-next-line no-console
  console.log('\n>>> [schema] bunx prisma db push --accept-data-loss');
  const push = Bun.spawn(['bunx', 'prisma', 'db', 'push', '--accept-data-loss'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await push.exited) !== 0) return false; // push критичен — всегда стоп

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

async function runOne(step: Step, dryRun: boolean): Promise<{ ok: boolean; code: number }> {
  const cmd = ['bun', 'run', step.script, ...(step.args ?? [])];
  // eslint-disable-next-line no-console
  console.log(`\n>>> [${step.phase}] ${cmd.slice(2).join(' ')}${step.hint ? `   # ${step.hint}` : ''}`);
  if (dryRun) return { ok: true, code: 0 };
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  return { ok: code === 0, code };
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
    const ok = await runSchemaPhase(args.dryRun, args.continueOnFail);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error('\n✗ SCHEMA PHASE упала (бэкап или push). Остановка — данные не тронуты.');
      process.exit(1);
    }
  }

  const results: { step: Step; ok: boolean; code: number }[] = [];
  for (const step of steps) {
    const r = await runOne(step, args.dryRun);
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
