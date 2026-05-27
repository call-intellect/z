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

  // === Backfill ===
  { phase: 'backfill', script: 'scripts/backfill-meeting-sources-fase1.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-entity-link-types-fase0.ts', skipBootstrap: true },
  { phase: 'backfill', script: 'scripts/backfill-commitment-due-dates.ts', skipBootstrap: true },

  // === Migrate (β-9 Telegram, legacy Task → Issue) ===
  { phase: 'migrate', script: 'scripts/migrate-telegram-channels-to-global.ts', skipBootstrap: true },
  { phase: 'migrate', script: 'scripts/migrate-task-to-issue.ts', args: ['--apply'], skipBootstrap: true },
];

interface ParsedArgs {
  mode: 'bootstrap' | 'update' | 'all';
  dryRun: boolean;
  continueOnFail: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'all';
  let dryRun = false;
  let continueOnFail = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') {
      const v = argv[++i];
      if (v === 'bootstrap' || v === 'update' || v === 'all') mode = v;
      else throw new Error(`Unknown --mode value: ${v}`);
    } else if (a === '--dry-run') dryRun = true;
    else if (a === '--continue-on-fail') continueOnFail = true;
    else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: bun run scripts/apply-prod-deploy.ts [--mode bootstrap|update|all] [--dry-run] [--continue-on-fail]`,
      );
      process.exit(0);
    }
  }
  return { mode, dryRun, continueOnFail };
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
  console.log(`=== apply-prod-deploy mode=${args.mode} dryRun=${args.dryRun} steps=${steps.length} ===`);

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
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ ALL APPLIED`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('apply-prod-deploy FAILED:', err);
  process.exit(1);
});
