# ТЗ — Конфигурация: крутилки в AdminSetting, секреты в ENV (гейт + полный перенос)

> Дата: 2026-06-20 · Тип: ТЗ (правило + машинный гард + серверная валидация + перенос конфигурации). Единое ТЗ, разбито по Шагам 1–10.
> Анализ-источник: [plans/analysis/2026-06-20-config-env-vs-admin-settings-audit.md](../analysis/2026-06-20-config-env-vs-admin-settings-audit.md)
> Решения владельца: глубина = «гейт + операционные крутилки сейчас, остаток по востребованию»; GRAY = пакет Р1–Р6; порядок = **гейт первым**.

## Цель

1. Поставить **гейт**: новая крутилка физически не может утечь в ENV/код мимо суперадминки (правило + lint-гард + серверная валидация).
2. Вернуть 26 прямых `process.env.*` под валидируемую схему и проводку в `AdminSetting`.
3. Перенести в админку крутилки, которые **реально крутят** (retention, логи, лимиты, probe/курация, часы дайджестов) + GRAY-набор по Р1/Р3/Р5 (модели LLM, продуктовые рубильники).
4. Зафиксировать (Шаги 9–10) остаток ~240 редких ENV-крутилок и 60-90 хардкод-констант — чтобы не забыть; исполняются по востребованию, гейт держит инвариант.

**Критерий «секрет vs крутилка» (что остаётся в ENV):** секреты (ключи/пароли/токены/соли/секреты подписи/ключи шифрования), connection strings (`DATABASE_URL`/`REDIS_URL`), bootstrap до БД (`NODE_ENV`/`PORT`/`LOG_LEVEL`/домены cookie/публичный URL), креды+endpoint внешней инфры (S3/LiveKit/TURN/SMTP/LLM-провайдеры/платёжка). Всё остальное — крутилка → `AdminSetting`. Полная таблица + 6 GRAY-решений — §2/§6 анализа.

## Карта шагов

| Шаг | Что | Блок | Статус |
|---|---|---|---|
| 1 | Правило (CLAUDE.md + code-pitfalls + feature-flags + memory) | Гейт | **✅ сделано 2026-06-20** |
| 2 | Машинный гард (классификация ENV + запрет `process.env.*`) | Гейт | `[ ]` |
| 3 | Серверная валидация `AdminSettingsService.set()` по реестру | Гейт | `[ ]` |
| 4 | Чистка 26 прямых `process.env.*` | Гейт | `[ ]` |
| 5 | Перенос: retention + логи | Перенос | `[ ]` |
| 6 | Перенос: лимиты/квоты | Перенос | `[ ]` |
| 7 | Перенос: probe + остаток курации | Перенос | `[ ]` |
| 8 | GRAY → админка (модели LLM, рубильники, часы дайджестов) | Перенос | `[ ]` |
| 9 | Остаток ~240 редких ENV-крутилок по доменам | По востребованию | `[ ]` |
| 10 | Хардкод-крутилки в коде/SQL → `getDynamic` (60-90+) | По востребованию | `[ ]` |

## Контекст кода (факты аудита)

- ENV: [env.schema.ts](../../backend/src/common/config/env.schema.ts) (~250, Zod). Чтение: [typed-config.service.ts](../../backend/src/common/config/typed-config.service.ts) — `this.get('X')` = только ENV; `resolveSync('admin.key','X',def)` / `getDynamic(...)` = admin→ENV→default.
- Реестр admin-ключей: [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) (`getSchemaForKey` → Zod, `z.unknown()` если нет).
- 🔴 `AdminSettingsService.set()` принимает `z.unknown()` — не валидирует value, не требует reason по severity (валидация только на фронте).
- 26 прямых `process.env.*` мимо схемы (полный список — §5.3 анализа).
- AdminSetting: [schema.prisma:10192](../../backend/prisma/schema.prisma#L10192) (+ `AdminSettingHistory`). Сиды: `backend/scripts/seed-admin-setting-*.ts` (+ агрегатор `apply-prod-deploy.ts`).

**Рунбук переноса одной крутилки** (для Шагов 4–10): (1) строка в реестре `['<admin.key>', <Zod>]`; (2) геттер `typed-config` — `this.get('X')` → `this.resolveSync<T>('<admin.key>','X',def)` (sync) или `await getDynamic` (async/hot-path); (3) сид `seed-admin-setting-*.ts` + STEPS в `apply-prod-deploy.ts`; (4) `SettingSpec` в профильной `*SettingsClient.tsx` (фронт держит свою копию Zod — продублировать ограничения); (5) док-триггеры (флаг → `feature-flags.md`; сид → `prod-deploy-log.md` Шаг 7; ENV-fallback → Шаг 1).

**Подводные камни** (code-pitfalls TC4-6): `@Cron`-строки и concurrency воркеров НЕ применяются на лету (рестарт или no-op-гейт в теле крона); `set()` без серверной валидации (чинит Шаг 3); два кэша (L1 async + sync `cacheMap`); фронт дублирует Zod вручную. Часы доставки (`*_LOCAL_HOUR`) читаются per-run → на лету; чистые `*_CRON` — нет, их не переносим (Р1).

---

# БЛОК А — ГЕЙТ (Шаги 1–4)

## Шаг 1 — Правило (документация) `[x]` (внесено 2026-06-20)

Внесено во все 4 точки:
- **CLAUDE.md** — принцип 9 «Крутилки — в AdminSetting, не в ENV и не в коде».
- **second-brain/02_architecture/code-pitfalls.md** — TC4 (cron/concurrency не на лету), TC5 (`set()` без валидации), TC6 (запрет `process.env.*` + фронт дублирует Zod).
- **docs/operations/feature-flags.md** — строка-ссылка на критерий + аудит.
- **memory** `feedback_admin_settings_not_env_or_code` — усиление (запрет `process.env.*`, хардкод = нарушение, дыра `set()`).

## Шаг 2 — Машинный гард `[ ]`

Чтобы новый ENV/`process.env` падал в CI, а не проходил ревью «на глаз».

### 2.1. Снимок ENV с классификацией (`env-classification.guard.spec.ts`)
- `backend/src/common/config/env-classification.ts`: экспортировать `KEEP_ENV_KEYS: ReadonlySet<string>` (~68 секретов/инфра/bootstrap из §5.1 анализа) и `ADMIN_FALLBACK_ENV_KEYS: ReadonlySet<string>` (ENV, легитимно остающиеся fallback'ом для admin-ключа).
- Тест: достать все top-level ключи `EnvSchema`; утверждать `каждый ключ ∈ KEEP_ENV_KEYS ∪ ADMIN_FALLBACK_ENV_KEYS`. Новый неклассифицированный ключ → падение с инструкцией «секрет/инфра → KEEP_ENV_KEYS; крутилка → admin-ключ (resolveSync) + ADMIN_FALLBACK_ENV_KEYS. См. analysis 2026-06-20-config».

### 2.2. Запрет прямого `process.env.*` (`no-direct-process-env.guard.spec.ts`)
- Тест: прочитать `backend/src/**/*.ts` (исключая `*.spec.ts` + whitelist: `common/config/env.schema.ts`, `common/config/config.module.ts`, `main.ts`), грепнуть `process.env.`. Совпадение вне whitelist → падение с файл:строка + «Читай конфиг через TypedConfigService, не process.env».
- До Шага 4 тест красный на 26 нарушениях (намеренно). После Шага 4 — зелёный, держит инвариант.

**Приёмка Шага 2:** оба теста есть; 2.1 зелёный, ломается при добавлении фейковой ENV; 2.2 краснеет на текущих 26; гоняются в `bun run test:unit`.

## Шаг 3 — Серверная валидация `set()` `[ ]`

В [admin-settings.service.ts](../../backend/src/modules/admin/settings/admin-settings.service.ts), метод `set(key, value, opts)`:
1. `getSchemaForKey(key)`; если ≠ `z.unknown()` → `safeParse(value)`; провал → `BadRequestException` (400) с issues.
2. reason-gate: severity `high`/`destructive` → требовать `reason` ≥ `MIN_REASON_LENGTH` (10); вынести константу в общий модуль (переиспользовать фронтовый порог).
3. Ключ не в реестре и нет строки в БД → текущее поведение + `warn` «set() для незарегистрированного ключа X».
4. Не ломать существующие валидные вызовы; прогнать `admin-settings.service.spec.ts` + добавить кейсы (невалидное → 400; high без reason → 400; валидное → ок).

**Приёмка Шага 3:** новые спеки зелёные; `set()` отвергает значение мимо `getSchemaForKey`; reason-gate на бэке; старые спеки целы.

## Шаг 4 — Чистка 26 прямых `process.env.*` `[ ]`

По доменам (каждый — отдельный коммит, можно параллельно):

| Под-шаг | Файл-источник | Переменные | Куда |
|---|---|---|---|
| 4.1 Concierge | `typed-config.service.ts:1337-1389` | `CONCIERGE_*` (13) | Объявить в `env.schema.ts` (новая `ConciergeSchema`); геттер `concierge` с `process.env` → `resolveSync('concierge.<key>','CONCIERGE_*',def)`; флаги/лимиты → admin + реестр + сид `seed-admin-setting-concierge.ts` (дополнить). `CONCIERGE_LOOPBACK_BASE_URL` → KEEP_ENV (Р2, инфра-endpoint). |
| 4.2 Orchestrator | `orchestrator.config.ts:25-33` | `ORCHESTRATOR_*` (3) | Объявить (`OrchestratorSchema`); `readOrchestratorLimits()` → через `TypedConfigService`; флаг+лимиты → admin. |
| 4.3 Router-fallback | `router.service.ts:697-719` | `ROUTER_FALLBACK_*`, `ROUTER_LLM_FALLBACK_ENABLED` | Объявить в `RouterSchema`; `resolveSync`; TTL/флаг → admin. |
| 4.4 Воркеры/кроны | `axis-classifier.service.ts:343`, `role-profiles.service.ts:16`, `consistency-checker.cron.ts:13/18`, `completeness-scanner.cron.ts:336`, `goal-alignment-low.cron.ts:16`, `telegram-digest.cron.ts:220` | `AXIS_CLASSIFY_ENABLED`, `ROLE_PROFILE_MIN_BLOCKS`, `CONSISTENCY_CHECKER_*` (2), `COMPLETENESS_SCANNER_ENABLED`, `GOAL_ALIGNMENT_LOW_ENABLED`, `TELEGRAM_DIGEST_HOUR_LOCAL` | Объявить в профильных схемах; `getDynamic` (воркеры — async); kill-switch'и → admin + реестр + сид + строка в `feature-flags.md`. |

Для каждого: объявить ENV + добавить в `ADMIN_FALLBACK_ENV_KEYS` (Шаг 2.1); проводка + реестр; сид + STEPS; UI-поле; kill-switch'и → `feature-flags.md`.

**Приёмка Шага 4:** тест 2.2 зелёный (0 `process.env` вне whitelist); каждая бывшая переменная читается через `TypedConfigService` и редактируется из админки; `typecheck`+`lint`+`build`+`test:unit` зелёные.

---

# БЛОК Б — ПЕРЕНОС ОПЕРАЦИОННЫХ КРУТИЛОК (Шаги 5–8)

> Перед каждым шагом построчно перепроверить текущую проводку по `typed-config.service.ts` (аудит — порядок величин, не построчный наряд): `resolveSync`-already → только реестр+сид+UI; `get-only` → ещё переписать геттер.

## Шаг 5 — Retention + Логи `[ ]`
Раздел: «Платформа → Хранение/Логи».

| admin.key | ENV | дефолт | проводка | severity |
|---|---|---|---|---|
| `retention.defaultDays` / `softDeleteGraceDays` / `webhookDeliveryDays` / `shareViewDays` / `apiAccessLogDays` / `sweepBatchSize` | DEFAULT_RETENTION_DAYS, SOFT_DELETE_GRACE_DAYS, WEBHOOK_DELIVERY_RETENTION_DAYS, SHARE_VIEW_RETENTION_DAYS, API_ACCESS_LOG_RETENTION_DAYS, RETENTION_SWEEP_BATCH_SIZE | 30/30/30/90/30/500 | resolveSync ✓ | medium/low |
| `retention.rawEventsEnabled`/`auditEnabled`/`chatEnabled`/`blocksEnabled` | RETENTION_*_ENABLED | см. схему | resolveSync ✓ | medium |
| `logging.*` (11) | LOG_DB_ENABLED, LOG_DB_MIN_LEVEL, LOG_DB_BATCH_SIZE, LOG_DB_FLUSH_INTERVAL_MS, LOG_DB_MAX_BUFFER, LOG_DB_RETENTION_DAYS, LOG_DB_STACK_TRACES, LOG_DB_REQUEST_BODY, LOG_DB_RESPONSE_BODY, LOG_DB_SUCCESS_REQUESTS, LOG_DB_SLOW_REQUEST_MS | см. схему | **get-only → resolveSync** | low (REQUEST/RESPONSE_BODY — medium: PII) |

`RETENTION_CRON` НЕ переносим (Р1).

**Приёмка:** все ключи в реестре+сиде+UI; `logging` геттер через resolveSync; правка применяется (retention — на следующем sweep; logging — на следующем flush/запросе).

## Шаг 6 — Лимиты и квоты `[ ]`
Раздел: «Платформа → Лимиты».

| admin.key | ENV | проводка |
|---|---|---|
| `limits.*` (~22) | MAX_API_KEYS_PER_USER, MAX_CHAT_REQUESTS_PER_DAY, MAX_CHAT_TOKENS_PER_DAY, EXPORT_ZIP_*, CLIP_MAX_DURATION_SECONDS, MAX_*_PER_USER/DAY, MAX_CHAT_MESSAGE_CHARS, MAX_ROOM_MESSAGE_CHARS, … | resolveSync ✓ (реестр+сид+UI; массово одним `seed-admin-setting-limits.ts`) |
| `limits.maxParticipantsPerMeeting` / `maxMeetingDurationHours` | MAX_PARTICIPANTS_PER_MEETING, MAX_MEETING_DURATION_HOURS | resolveSync ✓ |
| `share.*` (3) | SHARE_TOKEN_LENGTH_BYTES, SHARE_DEFAULT_EXPIRATION_DAYS, SHARE_ALLOWED_EXPIRATION_DAYS | resolveSync ✓ |
| `aiChatQuota.*` (3) | AI_CHAT_DAILY_LIMIT_ADMIN, AI_CHAT_DAILY_LIMIT_MEMBER, AI_CHAT_ADMIN_ROLES | **get-only → resolveSync** |
| `smartTables.*` (6) | TABLE_MAX_ROWS_PER_TABLE, TABLE_MAX_PROPS_PER_TABLE, TABLE_MAX_TABLES_PER_ORG, TABLE_MAX_CELL_SIZE_BYTES, TABLE_IMPORT_MAX_FILE_MB, TABLE_IMPORT_MAX_ROWS | **get-only → resolveSync** |

**Приёмка:** реестр+сид+UI на все; геттеры `aiChatQuota`/`smartTables` через resolveSync; правка лимита из UI отражается без рестарта.

## Шаг 7 — Probe + остаток Curation `[ ]`

| admin.key | ENV | проводка |
|---|---|---|
| `probe.*` (10) | PROBE_DEDUP_TTL_HOURS, PROBE_RATE_LIMIT_PER_USER_PER_HOUR/DAY, PROBE_EXPIRY_DAYS, PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN, PROBE_COLD_START_MODE_HOURS, PROBE_RESPONSE_CLASSIFY_*, PROBE_VOICE_INPUT_ENABLED, PROBE_SUBJECT_ADDRESSING_ENABLED | **get-only → resolveSync** |
| `knowledge.curation*` остаток | CURATION_ITEM_EXPIRY_DAYS, CARD_STALE_MONTHS_THRESHOLD, CARD_STALE_DYNAMIC_SCORE_THRESHOLD | get-only → resolveSync |

`PROBE_PRIORITY_REFRESH_CRON`, `CARD_STALE_DETECTOR_CRON` НЕ переносим (Р1). Флаги probe → синхронизировать с `feature-flags.md`.

**Приёмка:** probe-крутилки редактируемы; пороги/окна применяются на лету (per-event).

## Шаг 8 — GRAY → админка (Р1/Р3/Р5) `[ ]`

### 8.1 Модели LLM (Р3) — раздел `admin/ai-models` / llm-routes
| admin.key | ENV | дефолт | severity |
|---|---|---|---|
| `ai.anthropic.model` | ANTHROPIC_MODEL | claude-sonnet-4-6 | medium |
| `ai.vox.model` | VOX_MODEL | v3_rnnt | medium |
| `ai.deepseek.defaultModel` | DEEPSEEK_DEFAULT_MODEL | deepseek-v4-flash | medium |
| `gepa.reflectionLm` / `gepa.taskLm` | GEPA_REFLECTION_LM / GEPA_TASK_LM | deepseek-v4-pro | low |

Все `get-only` → resolveSync; свести под существующую поверхность управления моделями, не плодить новую страницу.

### 8.2 Продуктовые рубильники (Р5)
| admin.key | ENV | дефолт | тип |
|---|---|---|---|
| `ai.mainReport.primary` | LLM_MAIN_REPORT_PRIMARY | deepseek | enum(minimax/deepseek), kill-switch |
| `mail.dryRun` | MAIL_DRY_RUN | false | feature-flag |
| `operations.daily_digest.deliver_to_webpush` | OPS_DIGEST_DELIVER_TO_WEBPUSH | true | добить в реестр (частично admin) |

`LLM_MAIN_REPORT_PRIMARY` уже в `feature-flags.md` как ENV-enum — синхронизировать (admin-ключ + сид, ENV-fallback).

### 8.3 Часы доставки дайджестов (Р1 — часы, НЕ cron) — раздел «Операции/Уведомления»
| admin.key | ENV | дефолт |
|---|---|---|
| `betaOps.morningLocalHour` / `eveningLocalHour` | DAILY_CHECKIN_MORNING/EVENING_LOCAL_HOUR | 9 / 18 |
| `betaOps.weeklyDigestLocalHour` / `weeklyDigestLocalDay` | COO_WEEKLY_DIGEST_LOCAL_HOUR/DAY | 8 / 1 |
| `betaOps.dailyDigestHourUtc` | COO_DAILY_DIGEST_HOUR_UTC | 22 |
| `betaOps.commitmentFollowupLocalHour` | COMMITMENT_FOLLOWUP_LOCAL_HOUR | 9 |

Все `get-only` (`Number(this.get(...))`) → resolveSync. Читаются per-run в теле крона → применяются на лету.

**Приёмка Шага 8:** модели/рубильники/часы редактируемы из админки; ENV — fallback; enum-рубильники в `feature-flags.md`; часы применяются без рестарта.

---

# БЛОК В — ОСТАТОК (Шаги 9–10, по востребованию)

> Не делаем сейчас (решение «глубина = гейт + операционные»). Зафиксировано, чтобы не забыть. Гейт (Шаги 1–4) держит инвариант — новые крутилки сюда не добавляются. Делать доменными подшагами, каждый = отдельный коммит/сид/страница.

## Шаг 9 — Остаток ~240 редких ENV-крутилок `[ ]`
Доменными волнами (по убыванию пользы), по рунбуку:
- **KnowledgeCore (~41):** `DISTILL_*`, `ENTITY_*`, `THEME_*`, `BLOCK_INGEST_*`, `CHAT_V2_*`, `BITEMPORAL_*`, `FACT_SUPERSEDE_*` (часть уже resolveSync — только реестр+сид+UI).
- **Skill/clone/persona (~34):** `SKILL_*`, `CLONE_*`, `PERSONA_REBUILD_*`, `EXECUTABLE_PERSONA_*`, `DOMAIN_EXPANDER_*`, `BRAND_VOICE_*` (перепроверить ложноположительные `not-read` — §5.4 анализа).
- **BetaOps остаток (~20):** `PROACTIVE_RULE_*`, `INVITE_*`, `MAGIC_LINK_*`, `COMMITMENT_*` (кроме часов из Шага 8).
- **Tracker/governance (~31):** `AUTORULE_*`, `PRACTICE_SKILLS_*`, `GEPA_*` (кроме моделей), `TEMPORAL_PROBE_*`, `SIGNAL_TYPE_*`.
- **DialogLayer/Insights/Ideas/Budget/Recording/Conversational/MaxBot остаток.**
- `*_CRON` периодичности и concurrency — оставить в ENV (Р1/Р6), внести в `ADMIN_FALLBACK_ENV_KEYS`/`KEEP_ENV_KEYS` соответственно.

**Приёмка:** к концу — все крутилки-домены редактируемы; в `env.schema.ts` остаются только `KEEP_ENV_KEYS` + cron/concurrency-fallback'и; тест 2.1 зелёный без новых неклассифицированных.

## Шаг 10 — Хардкод-крутилки в коде/SQL → `getDynamic` `[ ]`
60-90+ магических констант (§5.6 анализа), по эталону `probe.service.ts` (`getDynamic(key, undefined, codeFallback)`). Приоритет:
- **knowledge-core:** `similarity >= 0.78` / `cosine >= 0.92` в SQL резолва сущностей ([entity-resolution.service.ts:1412](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L1412), [:771](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L771)); `dynamicScore > 0.1` reframing.
- **dashboard:** пороги настроения/выгорания/окна (`drop>=0.2/0.4`, `MIN_COHORT_SIZE`, `*_WINDOW_DAYS`) — десятки в `dashboard/services` + `dashboard/agents`.
- **ai:** `MONOLOGUE_THRESHOLD_MS`, `TURN_GAP_MS`; retention логов AI (`SCRUB_DAYS`/`DELETE_DAYS`).
- **billing/tracker/прочее** из сэмпла §5.6.

**Приёмка:** перенесённые константы читаются через `getDynamic` с code-fallback + реестр + сид + UI; магия из hot-path/SQL вынесена.

---

## Глобальная приёмка
- `bun run typecheck && lint && build && test:unit` — зелёные (вкл. 2 guard-теста Шага 2 и спеки `set()` Шага 3).
- 0 прямых `process.env.*` вне whitelist (тест 2.2 зелёный).
- Новая ENV без классификации валит CI; `set()` отвергает невалидное значение и требует reason для high/destructive.
- Перенесённые ключи: реестр + сид (+ STEPS) + UI; геттер через resolveSync/getDynamic; правка из админки отражается (live, где применимо).
- `second-brain/01_projects/admin.md` обновлён списком новых редактируемых разделов.

## Прод-операции (diff)
- Новые сиды `seed-admin-setting-*` (concierge доп., orchestrator, router-fallback, воркеры, retention-logging, limits, smart-tables, ai-chat-quota, probe, llm-models, digest-hours) → `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md` Шаг 7.
- Новые ENV-fallback в `env.schema.ts` → `prod-deploy-log.md` Шаг 1.
- Новые kill-switch → `feature-flags.md`.
- Применение: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Рестарт не требуется (перенесённые — live; cron-строки не трогаем).

## Итог
**Реализовано: Шаги 2–8.**
- **Блок А (Шаги 2–4 — гейт):** `env-classification.ts` (`KEEP_ENV_KEYS`/`ADMIN_FALLBACK_ENV_KEYS`) + гард-тесты `env-classification.guard.spec.ts` и `no-direct-process-env.guard.spec.ts`; серверная валидация `AdminSettingsService.set()` (Zod по реестру + reason-gate для severity `high`/`destructive`, `MIN_REASON_LENGTH=10`).
- **Блок Б (Шаги 5–8 — перенос):** развязаны 27 прямых `process.env.*` (concierge/orchestrator/router/воркеры) на `resolveSync`/`getDynamic`; 3 bootstrap-чтения (`LOG_LEVEL`/`NODE_ENV`/`@Cron MAIL_INBOX_POLL_CRON`) в whitelist. ~100 крутилок переведены в `AdminSetting` (реестр + сиды): concierge(12), orchestrator(3), router(3), воркеры(7), retention/logging(21), limits/share/aiChatQuota/smartTables(36), probe/curation(13), модели LLM + рубильники + часы дайджестов(25). Новые сиды `seed-admin-setting-{orchestrator, router-fallback, worker-knobs, retention-logging, limits, probe-curation, llm-models-and-gray, voice-note-retention}` + дополнен `seed-admin-setting-concierge` — все в `apply-prod-deploy.ts` STEPS (`phase:'seed-base'`).

**Осталось — Блок В (Шаги 9–10): остаток ~240 редких ENV + 60–90 хардкод-констант** — осознанно **по востребованию** (решение владельца), доменными волнами по рунбуку. Гейт (Шаги 2–4) держит инвариант: новые крутилки сюда мимо реестра не добавляются.

**Прод-операции:** новые ENV-fallback (Шаг 1) + сиды (Шаг 7) — см. `docs/operations/prod-deploy-log.md`. Применение — `apply-prod-deploy.ts --mode update`; рестарт не требуется (перенесённые — live).
